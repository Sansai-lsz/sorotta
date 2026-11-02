/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";

export function migration(name: string): string {
  return readFileSync(join(import.meta.dirname, "..", "..", "migrations", name), "utf8");
}

function toSqlValue(value: unknown): SQLInputValue {
  if (value === null || typeof value === "string" || typeof value === "number") return value;
  throw new Error(`unsupported bind value: ${String(value)}`);
}

class FakeStatement {
  constructor(
    private readonly sqlite: DatabaseSync,
    private readonly sql: string,
    private readonly params: SQLInputValue[] = [],
  ) {}

  bind(...values: unknown[]): FakeStatement {
    return new FakeStatement(this.sqlite, this.sql, values.map(toSqlValue));
  }

  execute() {
    const stmt = this.sqlite.prepare(this.sql);
    if (stmt.columns().length > 0) {
      return { success: true, meta: { changes: 0 }, results: stmt.all(...this.params) };
    }
    const { changes } = stmt.run(...this.params);
    return { success: true, meta: { changes: Number(changes) }, results: [] };
  }

  async run() {
    return this.execute();
  }

  async all() {
    return this.execute();
  }

  async first() {
    return this.sqlite.prepare(this.sql).get(...this.params) ?? null;
  }
}

class FakeD1 {
  constructor(private readonly sqlite: DatabaseSync) {}

  prepare(sql: string): FakeStatement {
    return new FakeStatement(this.sqlite, sql);
  }

  async batch(statements: FakeStatement[]) {
    this.sqlite.exec("BEGIN");
    try {
      const results = statements.map((s) => s.execute());
      this.sqlite.exec("COMMIT");
      return results;
    } catch (err) {
      this.sqlite.exec("ROLLBACK");
      throw err;
    }
  }
}

export function asD1(sqlite: DatabaseSync): D1Database {
  // db/ のモジュールが使う D1 のメソッドだけを node:sqlite で実装した偽物なので、型はここで一度だけ合わせる
  return new FakeD1(sqlite) as unknown as D1Database;
}

export function openDatabase(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration("0001_init.sql"));
  sqlite.exec(migration("0002_time_buckets.sql"));
  sqlite.exec(migration("0003_notify_role.sql"));
  sqlite.exec(migration("0004_recruitment_notify_role.sql"));
  return asD1(sqlite);
}
