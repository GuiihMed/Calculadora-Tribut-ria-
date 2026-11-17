import Database from 'better-sqlite3';
import path from 'node:path';

export const DEFAULT_OFICIAL_DB_PATH = path.resolve('data/rtc-oficial.db');

/**
 * Opens the official RFB catalog SQLite database strictly in read-only mode.
 * Fails immediately if the database file does not exist (`fileMustExist: true`).
 */
export function openOficialDbReadOnly(dbPath: string = DEFAULT_OFICIAL_DB_PATH): Database.Database {
  return new Database(path.resolve(dbPath), {
    readonly: true,
    fileMustExist: true,
  });
}
