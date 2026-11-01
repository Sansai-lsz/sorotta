/// <reference types="node" />
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyAnswer,
  createRecruitment,
  finishRecruitment,
  getRecruitment,
  listParticipants,
  markNotified,
  readSnapshot,
} from "./db.ts";
import type { Recruitment } from "./recruitment.ts";

function migration(name: string): string {
  return readFileSync(join(import.meta.dirname, "..", "migrations", name), "utf8");
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

function asD1(sqlite: DatabaseSync): D1Database {
  // db.ts が使う D1 のメソッドだけを node:sqlite で実装した偽物なので、型はここで一度だけ合わせる
  return new FakeD1(sqlite) as unknown as D1Database;
}

function openDatabase(): D1Database {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(migration("0001_init.sql"));
  sqlite.exec(migration("0002_time_buckets.sql"));
  return asD1(sqlite);
}

const rec: Recruitment = {
  id: "100",
  guildId: "g",
  channelId: "c",
  messageId: null,
  game: "Apex",
  min: 3,
  max: null,
  date: "2026-11-01",
  scope: "any",
  hostId: "host",
  status: "open",
  notifiedSlot: null,
};

describe("db", () => {
  let db: D1Database;

  beforeEach(async () => {
    db = openDatabase();
    await createRecruitment(db, rec, { kind: "toggleAnytime" });
  });

  it("募集を作ると募集した人が参加者になる", async () => {
    expect(await getRecruitment(db, rec.id)).toEqual(rec);
    expect(await listParticipants(db, rec.id)).toEqual([{ userId: "host", passed: false, anytime: true, slots: {} }]);
  });

  it("回答し直しても最初に回答した順を保つ", async () => {
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "night", hour: 21, now: false });
    await applyAnswer(db, rec.id, "b", { kind: "slot", bucket: "night", hour: 20, now: false });
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "night", hour: 22, now: true });
    expect(await listParticipants(db, rec.id)).toEqual([
      { userId: "host", passed: false, anytime: true, slots: {} },
      { userId: "a", passed: false, anytime: false, slots: { night: { hour: 22, now: true } } },
      { userId: "b", passed: false, anytime: false, slots: { night: { hour: 20, now: false } } },
    ]);
  });

  it("パスすると時刻といつでもOK を消し、その後に回答しても順番は変わらない", async () => {
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "noon", hour: 13, now: false });
    await applyAnswer(db, rec.id, "a", { kind: "toggleAnytime" });
    await applyAnswer(db, rec.id, "b", { kind: "slot", bucket: "night", hour: 20, now: false });
    await applyAnswer(db, rec.id, "a", { kind: "pass" });
    expect((await listParticipants(db, rec.id))[1]).toEqual({ userId: "a", passed: true });

    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "night", hour: 21, now: false });
    expect((await listParticipants(db, rec.id)).map((p) => p.userId)).toEqual(["host", "a", "b"]);
    expect((await listParticipants(db, rec.id))[1]).toEqual({
      userId: "a",
      passed: false,
      anytime: false,
      slots: { night: { hour: 21, now: false } },
    });
  });

  it("いつでもOK を押すとパスが解除される", async () => {
    await applyAnswer(db, rec.id, "a", { kind: "pass" });
    await applyAnswer(db, rec.id, "a", { kind: "toggleAnytime" });
    expect((await listParticipants(db, rec.id))[1]).toEqual({ userId: "a", passed: false, anytime: true, slots: {} });
  });

  it("無理を選ぶとその時間帯の回答だけを消す", async () => {
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "noon", hour: 13, now: false });
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "night", hour: 21, now: false });
    await applyAnswer(db, rec.id, "a", { kind: "clear", bucket: "noon" });
    expect((await listParticipants(db, rec.id))[1]).toEqual({
      userId: "a",
      passed: false,
      anytime: false,
      slots: { night: { hour: 21, now: false } },
    });
  });

  it.each([
    { kind: "slot", bucket: "night", hour: 21, now: false },
    { kind: "clear", bucket: "noon" },
    { kind: "toggleAnytime" },
    { kind: "pass" },
  ] as const)("締め切った後の回答 $kind は書き込まない", async (op) => {
    await applyAnswer(db, rec.id, "a", { kind: "slot", bucket: "noon", hour: 13, now: false });
    const before = await listParticipants(db, rec.id);
    await finishRecruitment(db, rec.id, "closed");
    await applyAnswer(db, rec.id, "a", op);
    await applyAnswer(db, rec.id, "b", op);
    expect(await listParticipants(db, rec.id)).toEqual(before);
  });

  it("募集と参加者をまとめて読む", async () => {
    await applyAnswer(db, rec.id, "a", { kind: "pass" });
    await finishRecruitment(db, rec.id, "cancelled");
    expect(await readSnapshot(db, rec.id)).toEqual({
      rec: { ...rec, status: "cancelled" },
      participants: [
        { userId: "host", passed: false, anytime: true, slots: {} },
        { userId: "a", passed: true },
      ],
    });
    expect(await readSnapshot(db, "999")).toBeNull();
  });

  it("募集を終えられるのは 1 回だけ", async () => {
    expect(await finishRecruitment(db, rec.id, "closed")).toBe(true);
    expect(await finishRecruitment(db, rec.id, "cancelled")).toBe(false);
    expect((await getRecruitment(db, rec.id))?.status).toBe("closed");
  });

  it("通知済みにできるのは 1 回だけで、最初に通知した時刻を残す", async () => {
    expect(await markNotified(db, rec.id, { bucket: "night", hour: 20 })).toBe(true);
    expect(await markNotified(db, rec.id, { bucket: "noon", hour: 12 })).toBe(false);
    expect((await getRecruitment(db, rec.id))?.notifiedSlot).toEqual({ bucket: "night", hour: 20 });
  });
});

describe("migration 0002", () => {
  it("既存の募集を締め切り扱いにし、旧形式の回答を捨てる", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(migration("0001_init.sql"));
    sqlite.exec(`
      INSERT INTO games (guild_id, name, required) VALUES ('g', 'Apex', 3);
      INSERT INTO recruitments (id, guild_id, channel_id, game, required, date, recruiter_id)
        VALUES ('1', 'g', 'c', 'Apex', 3, '2026-10-31', 'host');
      INSERT INTO entries (recruitment_id, user_id, hour) VALUES ('1', 'a', 21);
    `);
    sqlite.exec(migration("0002_time_buckets.sql"));
    const db = asD1(sqlite);

    expect(await getRecruitment(db, "1")).toEqual({
      id: "1",
      guildId: "g",
      channelId: "c",
      messageId: null,
      game: "Apex",
      min: 3,
      max: null,
      date: "2026-10-31",
      scope: "night",
      hostId: "host",
      status: "closed",
      notifiedSlot: null,
    });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'entries'").all()).toEqual([]);
  });
});
