import crypto from 'node:crypto';
import { maskFiscalPii } from './pii-masker.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface ZeroPiiLogEntry {
  timestamp?: string;
  request_id?: string;
  method?: string;
  route?: string;
  status?: number;
  duration_ms?: number;
  error_type?: string;
  [extra: string]: unknown;
}

export interface ZeroPiiLogger {
  debug(entry: ZeroPiiLogEntry, _ignoredMessage?: string): void;
  info(entry: ZeroPiiLogEntry, _ignoredMessage?: string): void;
  warn(entry: ZeroPiiLogEntry, _ignoredMessage?: string): void;
  error(entry: ZeroPiiLogEntry, _ignoredMessage?: string): void;
  log(level: LogLevel, entry: ZeroPiiLogEntry): void;
}

/**
 * Generates a fresh 32-char lowercase hex request ID on the server.
 * Any caller-supplied X-Request-Id header is intentionally ignored.
 */
export function generateRequestId(_incomingHeader?: string): string {
  return crypto.randomBytes(16).toString('hex');
}

function sanitizeOptionalString(val: unknown): string | undefined {
  if (typeof val !== 'string') {
    return undefined;
  }
  const trimmed = val.trim();
  if (!trimmed) {
    return undefined;
  }
  return maskFiscalPii(trimmed);
}

function sanitizeOptionalNumber(val: unknown): number | undefined {
  if (typeof val !== 'number' || !Number.isFinite(val)) {
    return undefined;
  }
  return val;
}

function buildSanitizedRecord(level: LogLevel, entry: ZeroPiiLogEntry): Record<string, unknown> {
  const timestamp =
    typeof entry.timestamp === 'string' && entry.timestamp.trim().length > 0
      ? entry.timestamp.trim()
      : new Date().toISOString();

  const record: Record<string, unknown> = {
    level,
    timestamp,
  };

  const requestId = sanitizeOptionalString(entry.request_id);
  if (requestId !== undefined) {
    record.request_id = requestId;
  }

  const method = sanitizeOptionalString(entry.method);
  if (method !== undefined) {
    record.method = method;
  }

  const route = sanitizeOptionalString(entry.route);
  if (route !== undefined) {
    record.route = route;
  }

  const status = sanitizeOptionalNumber(entry.status);
  if (status !== undefined) {
    record.status = status;
  }

  const durationMs = sanitizeOptionalNumber(entry.duration_ms);
  if (durationMs !== undefined) {
    record.duration_ms = durationMs;
  }

  const errorType = sanitizeOptionalString(entry.error_type);
  if (errorType !== undefined) {
    record.error_type = errorType;
  }

  return record;
}

export function createZeroPiiLogger(sink?: (jsonLine: string) => void): ZeroPiiLogger {
  const write = sink ?? ((jsonLine: string) => {
    process.stderr.write(`${jsonLine}\n`);
  });

  const emit = (level: LogLevel, entry: ZeroPiiLogEntry): void => {
    const safeRecord = buildSanitizedRecord(level, entry ?? {});
    write(JSON.stringify(safeRecord));
  };

  return {
    debug(entry: ZeroPiiLogEntry, _ignoredMessage?: string) {
      emit('debug', entry);
    },
    info(entry: ZeroPiiLogEntry, _ignoredMessage?: string) {
      emit('info', entry);
    },
    warn(entry: ZeroPiiLogEntry, _ignoredMessage?: string) {
      emit('warn', entry);
    },
    error(entry: ZeroPiiLogEntry, _ignoredMessage?: string) {
      emit('error', entry);
    },
    log(level: LogLevel, entry: ZeroPiiLogEntry) {
      emit(level, entry);
    },
  };
}
