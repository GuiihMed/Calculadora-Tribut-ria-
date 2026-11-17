import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

export interface BootstrapReport {
  dbPath: string;
  appliedMigrations: number;
  executedScripts: number;
  integrityOk: boolean;
  foreignKeyErrors: number;
  latestVersaoBaseDados: string | null;
}

/**
 * Executes an RFB SQL script, wrapping transactional migrations outside
 * `PRAGMA foreign_keys` toggles so `PRAGMA defer_foreign_keys = ON` takes effect
 * while `PRAGMA foreign_keys = OFF/ON` remains outside any transaction.
 */
function executeSqlScript(db: Database.Database, sql: string, allowTransaction: boolean): void {
  const togglesForeignKeys = /\bPRAGMA\s+foreign_keys\b/i.test(sql);
  if (!allowTransaction || togglesForeignKeys) {
    db.exec(sql);
    return;
  }
  const runInTx = db.transaction(() => {
    db.exec(sql);
  });
  runInTx();
}

function removeSidecarFiles(dbFilePath: string): void {
  for (const suffix of ['-wal', '-shm', '-journal']) {
    const sidecar = `${dbFilePath}${suffix}`;
    if (fs.existsSync(sidecar)) {
      fs.unlinkSync(sidecar);
    }
  }
}

/**
 * Compiles the official RFB Flyway SQL migrations (`beforeMigrate.sql`, `B0001`,
 * sorted `V0002..V0059`, and `afterMigrate.sql`) into a staging SQLite database,
 * verifies `PRAGMA integrity_check` and `PRAGMA foreign_key_check`, and atomically
 * renames the validated file into `targetDbPath`.
 */
export function bootstrapRfbDatabase(migrationsDir: string, targetDbPath: string): BootstrapReport {
  const resolvedMigrations = path.resolve(migrationsDir);
  const resolvedTarget = path.resolve(targetDbPath);
  const targetDir = path.dirname(resolvedTarget);
  fs.mkdirSync(targetDir, { recursive: true });

  const beforeMigratePath = path.join(resolvedMigrations, 'criacao', 'beforeMigrate.sql');
  const baselinePath = path.join(resolvedMigrations, 'criacao', 'B0001__sistema_tributario_completo.sql');
  const afterMigratePath = path.join(resolvedMigrations, 'criacao', 'afterMigrate.sql');
  const manutencaoDir = path.join(resolvedMigrations, 'manutencao');

  for (const requiredPath of [beforeMigratePath, baselinePath, afterMigratePath]) {
    if (!fs.existsSync(requiredPath)) {
      throw new Error(`Required RFB migration file not found: ${requiredPath}`);
    }
  }

  const maintenanceFiles = fs
    .readdirSync(manutencaoDir)
    .filter((file) => /^V\d+.*\.sql$/i.test(file))
    .sort((a, b) => a.localeCompare(b, 'en'));

  if (maintenanceFiles.length === 0) {
    throw new Error(`No maintenance migrations found in ${manutencaoDir}`);
  }

  const stagingPath = path.join(
    targetDir,
    `.${path.basename(resolvedTarget)}.staging-${process.pid}-${Date.now()}.db`,
  );

  let db: Database.Database | null = null;
  let appliedMigrations = 0;
  let executedScripts = 0;

  try {
    db = new Database(stagingPath);

    // 1. beforeMigrate.sql (PRAGMA configuration outside transaction)
    executeSqlScript(db, fs.readFileSync(beforeMigratePath, 'utf8'), false);
    executedScripts += 1;

    // 2. Baseline B0001 (contains PRAGMA foreign_keys = OFF / ON outside transaction)
    executeSqlScript(db, fs.readFileSync(baselinePath, 'utf8'), false);
    appliedMigrations += 1;
    executedScripts += 1;

    // 3. Sorted maintenance migrations V0002..V0059
    for (const file of maintenanceFiles) {
      const sql = fs.readFileSync(path.join(manutencaoDir, file), 'utf8');
      executeSqlScript(db, sql, true);
      appliedMigrations += 1;
      executedScripts += 1;
    }

    // 4. afterMigrate.sql (recreates nullable IS rate columns, indexes, ANALYZE, optimize)
    executeSqlScript(db, fs.readFileSync(afterMigratePath, 'utf8'), false);
    executedScripts += 1;

    // 5. Mandatory integrity and foreign key verification
    const integrityRows = db.prepare('PRAGMA integrity_check').pluck().all() as string[];
    const integrityOk = integrityRows.length === 1 && integrityRows[0] === 'ok';
    if (!integrityOk) {
      throw new Error(`SQLite integrity_check failed: ${integrityRows.join('; ')}`);
    }

    const fkRows = db.pragma('foreign_key_check') as unknown[];
    const foreignKeyErrors = fkRows.length;
    if (foreignKeyErrors > 0) {
      throw new Error(`SQLite foreign_key_check reported ${foreignKeyErrors} violation(s)`);
    }

    const latestVersionRow = db
      .prepare(
        'SELECT VRBD_VERSAO_BASE_DADO AS versao FROM VERSAO_BASE_DADO ORDER BY VRBD_ID DESC LIMIT 1',
      )
      .get() as { versao: string | null } | undefined;

    db.close();
    db = null;

    removeSidecarFiles(stagingPath);
    removeSidecarFiles(resolvedTarget);
    fs.renameSync(stagingPath, resolvedTarget);

    return {
      dbPath: resolvedTarget,
      appliedMigrations,
      executedScripts,
      integrityOk,
      foreignKeyErrors,
      latestVersaoBaseDados: latestVersionRow?.versao ?? null,
    };
  } catch (error) {
    if (db) {
      try {
        db.close();
      } catch {
        // Ignore close error during cleanup
      }
    }
    if (fs.existsSync(stagingPath)) {
      fs.unlinkSync(stagingPath);
    }
    removeSidecarFiles(stagingPath);
    throw error;
  }
}

const isCliEntry =
  process.argv[1] !== undefined &&
  pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url;

if (isCliEntry) {
  const migrationsDir = path.resolve(process.argv[2] ?? 'db/rfb-migrations');
  const targetDbPath = path.resolve(process.argv[3] ?? 'data/rtc-oficial.db');
  const report = bootstrapRfbDatabase(migrationsDir, targetDbPath);
  console.log(
    `[db:bootstrap] Created ${report.dbPath} (${report.appliedMigrations} migrations, ${report.executedScripts} scripts, integrityOk=${report.integrityOk}, fkErrors=${report.foreignKeyErrors}, versao=${report.latestVersaoBaseDados ?? 'N/A'})`,
  );
}
