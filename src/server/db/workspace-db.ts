import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type {
  CalcRunSnapshot,
  EngineMode,
  ExtractionDraft,
  GeminiTurnStep,
  OperationContext,
  WorkspaceMessageRecord,
  WorkspaceSession,
} from '../../shared/types/fiscal.js';

export const DEFAULT_WORKSPACE_DB_PATH = path.resolve('data/workspace.db');

interface SessionRow {
  id: string;
  title: string;
  active_context_json: string | null;
  created_at: string;
  updated_at: string;
}

interface MessageRow {
  id: string;
  session_id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  steps_json: string | null;
  calc_run_id: string | null;
  draft_id: string | null;
  grounding_warning: string | null;
  created_at: string;
}

interface CalcRunRow {
  id: string;
  session_id: string | null;
  kind: CalcRunSnapshot['kind'];
  engine_mode: EngineMode;
  dh_fato_gerador: string;
  context_json: string;
  input_json: string;
  output_json: string;
  x_warning_dados_simulados: number;
  created_at: string;
}

interface ExtractionDraftRow {
  id: string;
  session_id: string | null;
  source_type: ExtractionDraft['sourceType'];
  filename: string;
  draft_json: string;
  created_at: string;
}

function safeJsonParse<T>(raw: string | null, fallback: T): T {
  if (!raw) {
    return fallback;
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/**
 * Local SQLite store (`workspace.db`) for conversation sessions, stateless turn-replay
 * steps, immutable `CalcRunSnapshot` audit records, and staged `ExtractionDraft`s.
 */
export class WorkspaceStore {
  private readonly db: Database.Database;

  constructor(dbPath: string = ':memory:') {
    const isMemory = dbPath === ':memory:';
    if (!isMemory) {
      const resolved = path.resolve(dbPath);
      fs.mkdirSync(path.dirname(resolved), { recursive: true });
      this.db = new Database(resolved);
      this.db.pragma('journal_mode = WAL');
    } else {
      this.db = new Database(':memory:');
    }

    this.db.pragma('foreign_keys = ON');
    this.initSchema();
  }

  getDatabase(): Database.Database {
    return this.db;
  }

  private initSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        active_context_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        steps_json TEXT,
        calc_run_id TEXT,
        draft_id TEXT,
        grounding_warning TEXT,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, created_at);

      CREATE TABLE IF NOT EXISTS calc_runs (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        kind TEXT NOT NULL,
        engine_mode TEXT NOT NULL,
        dh_fato_gerador TEXT NOT NULL,
        context_json TEXT NOT NULL,
        input_json TEXT NOT NULL,
        output_json TEXT NOT NULL,
        x_warning_dados_simulados INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_calc_runs_session_id ON calc_runs(session_id, created_at);

      CREATE TABLE IF NOT EXISTS extraction_drafts (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        source_type TEXT NOT NULL,
        filename TEXT NOT NULL,
        draft_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_extraction_drafts_session_id ON extraction_drafts(session_id, created_at);
    `);
  }

  createSession(
    title = 'Nova Simulação',
    context: Partial<OperationContext> = {},
  ): WorkspaceSession {
    const now = new Date().toISOString();
    const session: WorkspaceSession = {
      id: crypto.randomUUID(),
      title: title.trim() || 'Nova Simulação',
      activeContext: context,
      createdAt: now,
      updatedAt: now,
    };

    this.db
      .prepare(
        `INSERT INTO sessions (id, title, active_context_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.title,
        JSON.stringify(session.activeContext),
        session.createdAt,
        session.updatedAt,
      );

    return session;
  }

  getSession(id: string): WorkspaceSession | null {
    const row = this.db
      .prepare(
        `SELECT id, title, active_context_json, created_at, updated_at
         FROM sessions
         WHERE id = ?`,
      )
      .get(id) as SessionRow | undefined;

    return row ? this.mapSessionRow(row) : null;
  }

  listSessions(): WorkspaceSession[] {
    const rows = this.db
      .prepare(
        `SELECT id, title, active_context_json, created_at, updated_at
         FROM sessions
         ORDER BY updated_at DESC, rowid DESC`,
      )
      .all() as SessionRow[];

    return rows.map((row) => this.mapSessionRow(row));
  }

  updateSessionContext(
    id: string,
    context: Partial<OperationContext>,
    title?: string,
  ): WorkspaceSession | null {
    const existing = this.getSession(id);
    if (!existing) {
      return null;
    }

    const mergedContext: Partial<OperationContext> = {
      ...existing.activeContext,
      ...context,
    };
    const nextTitle = title !== undefined && title.trim() ? title.trim() : existing.title;
    const updatedAt = new Date().toISOString();

    this.db
      .prepare(
        `UPDATE sessions
         SET title = ?, active_context_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(nextTitle, JSON.stringify(mergedContext), updatedAt, id);

    return {
      ...existing,
      title: nextTitle,
      activeContext: mergedContext,
      updatedAt,
    };
  }

  appendMessage(msg: WorkspaceMessageRecord): WorkspaceMessageRecord {
    const record: WorkspaceMessageRecord = {
      ...msg,
      id: msg.id || crypto.randomUUID(),
      createdAt: msg.createdAt || new Date().toISOString(),
    };

    const insertTx = this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO messages (
             id, session_id, role, content, steps_json, calc_run_id, draft_id, grounding_warning, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          record.id,
          record.sessionId,
          record.role,
          record.content,
          record.steps ? JSON.stringify(record.steps) : null,
          record.calcRunId ?? null,
          record.draftId ?? null,
          record.groundingWarning ?? null,
          record.createdAt,
        );

      this.db
        .prepare(`UPDATE sessions SET updated_at = ? WHERE id = ?`)
        .run(record.createdAt, record.sessionId);
    });

    insertTx();
    return record;
  }

  listMessages(sessionId: string): WorkspaceMessageRecord[] {
    const rows = this.db
      .prepare(
        `SELECT id, session_id, role, content, steps_json, calc_run_id, draft_id, grounding_warning, created_at
         FROM messages
         WHERE session_id = ?
         ORDER BY created_at ASC, rowid ASC`,
      )
      .all(sessionId) as MessageRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      role: row.role,
      content: row.content,
      steps: row.steps_json ? safeJsonParse<GeminiTurnStep[]>(row.steps_json, []) : undefined,
      calcRunId: row.calc_run_id ?? undefined,
      draftId: row.draft_id ?? undefined,
      groundingWarning: row.grounding_warning ?? undefined,
      createdAt: row.created_at,
    }));
  }

  saveCalcRun(snapshot: CalcRunSnapshot): CalcRunSnapshot {
    const record: CalcRunSnapshot = {
      ...snapshot,
      id: snapshot.id || crypto.randomUUID(),
      createdAt: snapshot.createdAt || new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO calc_runs (
           id, session_id, kind, engine_mode, dh_fato_gerador,
           context_json, input_json, output_json, x_warning_dados_simulados, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId ?? null,
        record.kind,
        record.engineMode,
        record.dhFatoGerador,
        JSON.stringify(record.context ?? {}),
        JSON.stringify(record.input),
        JSON.stringify(record.output),
        record.xWarningDadosSimulados ? 1 : 0,
        record.createdAt,
      );

    return record;
  }

  getCalcRun(id: string): CalcRunSnapshot | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, kind, engine_mode, dh_fato_gerador,
                context_json, input_json, output_json, x_warning_dados_simulados, created_at
         FROM calc_runs
         WHERE id = ?`,
      )
      .get(id) as CalcRunRow | undefined;

    return row ? this.mapCalcRunRow(row) : null;
  }

  listCalcRuns(sessionId?: string): CalcRunSnapshot[] {
    const rows = (
      sessionId !== undefined
        ? this.db
            .prepare(
              `SELECT id, session_id, kind, engine_mode, dh_fato_gerador,
                      context_json, input_json, output_json, x_warning_dados_simulados, created_at
               FROM calc_runs
               WHERE session_id = ?
               ORDER BY created_at DESC, rowid DESC`,
            )
            .all(sessionId)
        : this.db
            .prepare(
              `SELECT id, session_id, kind, engine_mode, dh_fato_gerador,
                      context_json, input_json, output_json, x_warning_dados_simulados, created_at
               FROM calc_runs
               ORDER BY created_at DESC, rowid DESC`,
            )
            .all()
    ) as CalcRunRow[];

    return rows.map((row) => this.mapCalcRunRow(row));
  }

  saveExtractionDraft(draft: ExtractionDraft): ExtractionDraft {
    const record: ExtractionDraft = {
      ...draft,
      id: draft.id || crypto.randomUUID(),
      createdAt: draft.createdAt || new Date().toISOString(),
    };

    this.db
      .prepare(
        `INSERT INTO extraction_drafts (
           id, session_id, source_type, filename, draft_json, created_at
         ) VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.sessionId ?? null,
        record.sourceType,
        record.filename,
        JSON.stringify(record),
        record.createdAt,
      );

    return record;
  }

  getExtractionDraft(id: string): ExtractionDraft | null {
    const row = this.db
      .prepare(
        `SELECT id, session_id, source_type, filename, draft_json, created_at
         FROM extraction_drafts
         WHERE id = ?`,
      )
      .get(id) as ExtractionDraftRow | undefined;

    if (!row) {
      return null;
    }
    return safeJsonParse<ExtractionDraft | null>(row.draft_json, null);
  }

  updateExtractionDraft(
    id: string,
    patch: Partial<ExtractionDraft>,
  ): ExtractionDraft | null {
    const existing = this.getExtractionDraft(id);
    if (!existing) {
      return null;
    }

    const updated: ExtractionDraft = {
      ...existing,
      ...patch,
      id: existing.id,
      createdAt: existing.createdAt,
    };

    this.db
      .prepare(
        `UPDATE extraction_drafts
         SET session_id = ?, source_type = ?, filename = ?, draft_json = ?
         WHERE id = ?`,
      )
      .run(
        updated.sessionId ?? null,
        updated.sourceType,
        updated.filename,
        JSON.stringify(updated),
        id,
      );

    return updated;
  }

  close(): void {
    this.db.close();
  }

  private mapSessionRow(row: SessionRow): WorkspaceSession {
    return {
      id: row.id,
      title: row.title,
      activeContext: safeJsonParse<Partial<OperationContext>>(row.active_context_json, {}),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapCalcRunRow(row: CalcRunRow): CalcRunSnapshot {
    return {
      id: row.id,
      sessionId: row.session_id ?? undefined,
      kind: row.kind,
      engineMode: row.engine_mode,
      dhFatoGerador: row.dh_fato_gerador,
      context: safeJsonParse<Partial<OperationContext>>(row.context_json, {}),
      input: safeJsonParse<unknown>(row.input_json, {}),
      output: safeJsonParse<CalcRunSnapshot['output']>(row.output_json, {} as CalcRunSnapshot['output']),
      xWarningDadosSimulados: row.x_warning_dados_simulados === 1,
      createdAt: row.created_at,
    };
  }
}
