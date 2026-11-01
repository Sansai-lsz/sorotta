import type { Recruitment } from "./render.ts";
import type { Entry } from "./tally.ts";

export type Game = { name: string; required: number };

export async function upsertGame(db: D1Database, guildId: string, game: Game): Promise<void> {
  await db
    .prepare(
      "INSERT INTO games (guild_id, name, required) VALUES (?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET required = excluded.required",
    )
    .bind(guildId, game.name, game.required)
    .run();
}

export async function listGames(db: D1Database, guildId: string): Promise<Game[]> {
  const { results } = await db
    .prepare("SELECT name, required FROM games WHERE guild_id = ? ORDER BY name")
    .bind(guildId)
    .all<Game>();
  return results;
}

export async function searchGames(db: D1Database, guildId: string, prefix: string): Promise<Game[]> {
  const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await db
    .prepare("SELECT name, required FROM games WHERE guild_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 25")
    .bind(guildId, `${escaped}%`)
    .all<Game>();
  return results;
}

export async function findGame(db: D1Database, guildId: string, name: string): Promise<Game | null> {
  return db
    .prepare("SELECT name, required FROM games WHERE guild_id = ? AND name = ?")
    .bind(guildId, name)
    .first<Game>();
}

export async function deleteGame(db: D1Database, guildId: string, name: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM games WHERE guild_id = ? AND name = ?").bind(guildId, name).run();
  return result.meta.changes > 0;
}

export async function createRecruitment(
  db: D1Database,
  rec: Recruitment & { guildId: string; channelId: string },
): Promise<void> {
  await db
    .prepare(
      "INSERT INTO recruitments (id, guild_id, channel_id, game, required, date, recruiter_id) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .bind(rec.id, rec.guildId, rec.channelId, rec.game, rec.required, rec.date, rec.recruiterId)
    .run();
}

export async function getRecruitment(db: D1Database, id: string): Promise<Recruitment | null> {
  return db
    .prepare("SELECT id, game, required, date, recruiter_id AS recruiterId FROM recruitments WHERE id = ?")
    .bind(id)
    .first<Recruitment>();
}

export async function upsertEntry(db: D1Database, recruitmentId: string, entry: Entry): Promise<void> {
  await db
    .prepare(
      "INSERT INTO entries (recruitment_id, user_id, hour) VALUES (?, ?, ?) ON CONFLICT (recruitment_id, user_id) DO UPDATE SET hour = excluded.hour, updated_at = datetime('now')",
    )
    .bind(recruitmentId, entry.userId, entry.hour)
    .run();
}

export async function listEntries(db: D1Database, recruitmentId: string): Promise<Entry[]> {
  const { results } = await db
    .prepare("SELECT user_id AS userId, hour FROM entries WHERE recruitment_id = ? ORDER BY updated_at, user_id")
    .bind(recruitmentId)
    .all<Entry>();
  return results;
}

/** 通知済みにする。ほぼ同時に押されても true を返すのは 1 回だけ */
export async function markNotified(db: D1Database, recruitmentId: string): Promise<boolean> {
  const result = await db
    .prepare("UPDATE recruitments SET notified_at = datetime('now') WHERE id = ? AND notified_at IS NULL")
    .bind(recruitmentId)
    .run();
  return result.meta.changes === 1;
}
