import { DatabaseSync } from 'node:sqlite';
import { TransitStoreCore } from './store-core.js';
export { ApiError } from './store-core.js';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
export class TransitStore extends TransitStoreCore {
  constructor(path, network, publicAppUrl = '') {
    if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
    const database = new DatabaseSync(path);
    database.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
    const db = {
      exec: (sql) => database.exec(sql),
      prepare: (sql) => {
        const statement = database.prepare(sql);
        return {
          get: (...args) => statement.get(...args),
          all: (...args) => statement.all(...args),
          run: (...args) => statement.run(...args),
        };
      },
      transaction: (callback) => {
        database.exec('BEGIN IMMEDIATE');
        try {
          const result = callback();
          database.exec('COMMIT');
          return result;
        } catch (error) {
          database.exec('ROLLBACK');
          throw error;
        }
      },
      close: () => database.close(),
    };
    super(db, network, publicAppUrl);
  }
}
