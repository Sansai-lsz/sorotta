import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { findGame, listGames, upsertGame } from "./games.ts";
import { asD1, migration, openDatabase } from "./testDb.ts";

describe("games", () => {
  it("通知するロールを登録して読み出せる", async () => {
    const db = openDatabase();
    await upsertGame(db, "g", { name: "Apex", min: 3, max: 3, notifyRoleId: "r1" });
    expect(await findGame(db, "g", "Apex")).toEqual({ name: "Apex", min: 3, max: 3, notifyRoleId: "r1" });
  });

  it("登録し直すとロールも上書きし、省略すればロールを外す", async () => {
    const db = openDatabase();
    await upsertGame(db, "g", { name: "Apex", min: 3, max: null, notifyRoleId: "r1" });
    await upsertGame(db, "g", { name: "Apex", min: 2, max: null, notifyRoleId: null });
    expect(await listGames(db, "g")).toEqual([{ name: "Apex", min: 2, max: null, notifyRoleId: null }]);
  });
});

describe("migration 0003", () => {
  it("前から登録してあるゲームはロールなしで読める", async () => {
    const sqlite = new DatabaseSync(":memory:");
    sqlite.exec(migration("0001_init.sql"));
    sqlite.exec(migration("0002_time_buckets.sql"));
    sqlite.exec("INSERT INTO games (guild_id, name, required, max_players) VALUES ('g', 'Apex', 3, 3);");
    sqlite.exec(migration("0003_notify_role.sql"));

    expect(await findGame(asD1(sqlite), "g", "Apex")).toEqual({ name: "Apex", min: 3, max: 3, notifyRoleId: null });
  });
});
