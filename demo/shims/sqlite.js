// node:sqlite's DatabaseSync API on top of sql.js (SQLite compiled to JS), so
// src/db.ts runs unchanged in the browser. The engine is set by the entry point.

let SQL;
export function setSqlEngine(engine) {
  SQL = engine;
}

const clean = (params) => params.map((p) => (p === undefined ? null : typeof p === "boolean" ? Number(p) : p));

class Statement {
  constructor(db, sql) {
    this.db = db;
    this.sql = sql;
  }

  all(...params) {
    const stmt = this.db.prepare(this.sql);
    try {
      stmt.bind(clean(params));
      const rows = [];
      while (stmt.step()) rows.push(stmt.getAsObject());
      return rows;
    } finally {
      stmt.free();
    }
  }

  get(...params) {
    return this.all(...params)[0];
  }

  run(...params) {
    this.db.run(this.sql, clean(params));
    const changes = this.db.getRowsModified();
    const lastInsertRowid = this.db.exec("SELECT last_insert_rowid()")[0]?.values[0][0] ?? 0;
    return { changes, lastInsertRowid };
  }
}

export class DatabaseSync {
  constructor() {
    if (!SQL) throw new Error("SQL engine not initialised");
    this.db = new SQL.Database();
  }

  exec(sql) {
    this.db.exec(sql);
  }

  prepare(sql) {
    return new Statement(this.db, sql);
  }
}
