export type Game = { name: string; min: number; max: number | null; notifyRoleId: string | null };

const GAME_COLUMNS = "name, required AS min, max_players AS max, notify_role_id AS notifyRoleId";

export async function upsertGame(db: D1Database, guildId: string, game: Game): Promise<void> {
  await db
    .prepare(
      "INSERT INTO games (guild_id, name, required, max_players, notify_role_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET required = excluded.required, max_players = excluded.max_players, notify_role_id = excluded.notify_role_id",
    )
    .bind(guildId, game.name, game.min, game.max, game.notifyRoleId)
    .run();
}

export async function listGames(db: D1Database, guildId: string): Promise<Game[]> {
  const { results } = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE guild_id = ? ORDER BY name`)
    .bind(guildId)
    .all<Game>();
  return results;
}

export async function searchGames(db: D1Database, guildId: string, prefix: string): Promise<Game[]> {
  const escaped = prefix.replace(/[\\%_]/g, (c) => `\\${c}`);
  const { results } = await db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE guild_id = ? AND name LIKE ? ESCAPE '\\' ORDER BY name LIMIT 25`)
    .bind(guildId, `${escaped}%`)
    .all<Game>();
  return results;
}

export async function findGame(db: D1Database, guildId: string, name: string): Promise<Game | null> {
  return db
    .prepare(`SELECT ${GAME_COLUMNS} FROM games WHERE guild_id = ? AND name = ?`)
    .bind(guildId, name)
    .first<Game>();
}

export async function deleteGame(db: D1Database, guildId: string, name: string): Promise<boolean> {
  const result = await db.prepare("DELETE FROM games WHERE guild_id = ? AND name = ?").bind(guildId, name).run();
  return result.meta.changes > 0;
}
