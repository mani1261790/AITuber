import { runtime } from './context';
/** The synchronous SQL subset used by our stores, backed by DO SQLite. */
export default class Database {
  private storage = runtime().storage;
  pragma(statement: string) { if (!/^(foreign_keys|journal_mode|synchronous)\s*=/.test(statement)) throw new Error(`Unsupported pragma: ${statement}`); }
  exec(query: string) { this.storage.sql.exec(query).toArray(); return this; }
  prepare(query: string) {
    const exec = (...values: unknown[]) => this.storage.sql.exec(query, ...values);
    return {
      get: (...values: unknown[]) => exec(...values).toArray()[0],
      all: (...values: unknown[]) => exec(...values).toArray(),
      run: (...values: unknown[]) => { exec(...values).toArray(); const result = this.storage.sql.exec<{changes:number;lastInsertRowid:number}>("SELECT changes() AS changes, last_insert_rowid() AS lastInsertRowid").one(); return result; },
    };
  }
  transaction<T>(operation: () => T) { const execute = () => this.storage.transactionSync(operation); return Object.assign(execute,{immediate:execute,deferred:execute,exclusive:execute}); }
  close() { /* The Durable Object owns the database lifecycle. */ }
  backup() { throw new Error('Durable Object SQLite is persistent; file backups are not supported.'); }
}
