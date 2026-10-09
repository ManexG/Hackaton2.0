import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { TransitStoreCore, type SyncDatabase } from './store-core';
export { ApiError, type LocationFix } from './store-core';
import type { Network } from '../src/types';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export class TransitStore extends TransitStoreCore {
  constructor(path: string, network: Network, publicAppUrl = '') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const db: SyncDatabase = {
      exec: sql => database.exec(sql),
      prepare: sql => {
        const statement = database.prepare(sql);
        return { get: (...args) => statement.get(...args as SQLInputValue[]), all: (...args) => statement.all(...args as SQLInputValue[]), run: (...args) => statement.run(...args as SQLInputValue[]) };
      },
      transaction: callback => {
        database.exec('BEGIN IMMEDIATE');
        try { const result = callback(); database.exec('COMMIT'); return result; }
        catch (error) { database.exec('ROLLBACK'); throw error; }
      },
      close: () => database.close(),
    };
    super(db, network, publicAppUrl);
  }
}
