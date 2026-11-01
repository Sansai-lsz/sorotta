import type { AnswerOp } from "./answer.ts";
import { isBucketKey, isScope, type BucketKey } from "./buckets.ts";
import { isRecruitmentStatus, type ReadySlot, type Recruitment } from "./recruitment.ts";
import type { Participant, Slot } from "./tally.ts";

export type Game = { name: string; min: number; max: number | null };

const GAME_COLUMNS = "name, required AS min, max_players AS max";

export async function upsertGame(db: D1Database, guildId: string, game: Game): Promise<void> {
  await db
    .prepare(
      "INSERT INTO games (guild_id, name, required, max_players) VALUES (?, ?, ?, ?) ON CONFLICT (guild_id, name) DO UPDATE SET required = excluded.required, max_players = excluded.max_players",
    )
    .bind(guildId, game.name, game.min, game.max)
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

type RecruitmentRow = Omit<Recruitment, "scope" | "status" | "notifiedSlot"> & {
  scope: string;
  status: string;
  readyBucket: string | null;
  readyHour: number | null;
};

const RECRUITMENT_COLUMNS =
  "id, guild_id AS guildId, channel_id AS channelId, message_id AS messageId, game, required AS min, max_players AS max, date, scope, recruiter_id AS hostId, status, ready_bucket AS readyBucket, ready_hour AS readyHour";

function parseRecruitment(row: RecruitmentRow): Recruitment {
  const { scope, status, readyBucket, readyHour, ...rest } = row;
  if (!isScope(scope) || !isRecruitmentStatus(status)) {
    throw new Error(`invalid recruitment row ${row.id}: scope=${scope} status=${status}`);
  }
  if (readyBucket === null || readyHour === null) return { ...rest, scope, status, notifiedSlot: null };
  if (!isBucketKey(readyBucket)) throw new Error(`invalid recruitment row ${row.id}: ready_bucket=${readyBucket}`);
  return { ...rest, scope, status, notifiedSlot: { bucket: readyBucket, hour: readyHour } };
}

function answerStatements(db: D1Database, recruitmentId: string, userId: string, op: AnswerOp): D1PreparedStatement[] {
  const ensure = db
    .prepare("INSERT INTO participants (recruitment_id, user_id) VALUES (?, ?) ON CONFLICT DO NOTHING")
    .bind(recruitmentId, userId);
  switch (op.kind) {
    case "slot":
      return [
        ensure,
        db.prepare("UPDATE participants SET passed = 0 WHERE recruitment_id = ? AND user_id = ?").bind(recruitmentId, userId),
        db
          .prepare(
            "INSERT INTO slots (recruitment_id, user_id, bucket, hour, is_now) VALUES (?, ?, ?, ?, ?) ON CONFLICT (recruitment_id, user_id, bucket) DO UPDATE SET hour = excluded.hour, is_now = excluded.is_now",
          )
          .bind(recruitmentId, userId, op.bucket, op.hour, op.now ? 1 : 0),
      ];
    case "clear":
      return [
        ensure,
        db
          .prepare("DELETE FROM slots WHERE recruitment_id = ? AND user_id = ? AND bucket = ?")
          .bind(recruitmentId, userId, op.bucket),
      ];
    case "toggleAnytime":
      return [
        ensure,
        db
          .prepare("UPDATE participants SET anytime = 1 - anytime, passed = 0 WHERE recruitment_id = ? AND user_id = ?")
          .bind(recruitmentId, userId),
      ];
    case "pass":
      return [
        ensure,
        db
          .prepare("UPDATE participants SET passed = 1, anytime = 0 WHERE recruitment_id = ? AND user_id = ?")
          .bind(recruitmentId, userId),
        db.prepare("DELETE FROM slots WHERE recruitment_id = ? AND user_id = ?").bind(recruitmentId, userId),
      ];
    default: {
      const unreachable: never = op;
      throw new Error(`unknown answer op: ${JSON.stringify(unreachable)}`);
    }
  }
}

export async function createRecruitment(db: D1Database, rec: Recruitment, hostJoin: AnswerOp): Promise<void> {
  await db.batch([
    db
      .prepare(
        "INSERT INTO recruitments (id, guild_id, channel_id, message_id, game, required, max_players, date, scope, recruiter_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(rec.id, rec.guildId, rec.channelId, rec.messageId, rec.game, rec.min, rec.max, rec.date, rec.scope, rec.hostId, rec.status),
    ...answerStatements(db, rec.id, rec.hostId, hostJoin),
  ]);
}

export async function getRecruitment(db: D1Database, id: string): Promise<Recruitment | null> {
  const row = await db
    .prepare(`SELECT ${RECRUITMENT_COLUMNS} FROM recruitments WHERE id = ?`)
    .bind(id)
    .first<RecruitmentRow>();
  return row ? parseRecruitment(row) : null;
}

export async function listOpenRecruitmentsUntil(db: D1Database, date: string): Promise<Recruitment[]> {
  const { results } = await db
    .prepare(`SELECT ${RECRUITMENT_COLUMNS} FROM recruitments WHERE status = 'open' AND date <= ?`)
    .bind(date)
    .all<RecruitmentRow>();
  return results.map(parseRecruitment);
}

export async function saveMessageId(db: D1Database, id: string, messageId: string): Promise<void> {
  await db
    .prepare("UPDATE recruitments SET message_id = ? WHERE id = ? AND message_id IS NULL")
    .bind(messageId, id)
    .run();
}

export async function applyAnswer(db: D1Database, recruitmentId: string, userId: string, op: AnswerOp): Promise<void> {
  await db.batch(answerStatements(db, recruitmentId, userId, op));
}

type ParticipantRow = { userId: string; passed: number; anytime: number };
type SlotRow = { userId: string; bucket: string; hour: number; isNow: number };

export async function listParticipants(db: D1Database, recruitmentId: string): Promise<Participant[]> {
  const [participants, slots] = await Promise.all([
    db
      .prepare("SELECT user_id AS userId, passed, anytime FROM participants WHERE recruitment_id = ? ORDER BY id")
      .bind(recruitmentId)
      .all<ParticipantRow>(),
    db
      .prepare("SELECT user_id AS userId, bucket, hour, is_now AS isNow FROM slots WHERE recruitment_id = ?")
      .bind(recruitmentId)
      .all<SlotRow>(),
  ]);
  const slotsByUser = new Map<string, Partial<Record<BucketKey, Slot>>>();
  for (const row of slots.results) {
    if (!isBucketKey(row.bucket)) throw new Error(`invalid slot bucket in ${recruitmentId}: ${row.bucket}`);
    const userSlots = slotsByUser.get(row.userId) ?? {};
    userSlots[row.bucket] = { hour: row.hour, now: row.isNow === 1 };
    slotsByUser.set(row.userId, userSlots);
  }
  return participants.results.map((row): Participant =>
    row.passed === 1
      ? { userId: row.userId, passed: true }
      : { userId: row.userId, passed: false, anytime: row.anytime === 1, slots: slotsByUser.get(row.userId) ?? {} },
  );
}

/** 通知済みにする。ほぼ同時に押されても true を返すのは 1 回だけ */
export async function markNotified(db: D1Database, recruitmentId: string, slot: ReadySlot): Promise<boolean> {
  const result = await db
    .prepare(
      "UPDATE recruitments SET notified_at = datetime('now'), ready_bucket = ?, ready_hour = ? WHERE id = ? AND notified_at IS NULL",
    )
    .bind(slot.bucket, slot.hour, recruitmentId)
    .run();
  return result.meta.changes === 1;
}

export async function finishRecruitment(db: D1Database, id: string, status: "closed" | "cancelled"): Promise<boolean> {
  const result = await db
    .prepare("UPDATE recruitments SET status = ? WHERE id = ? AND status = 'open'")
    .bind(status, id)
    .run();
  return result.meta.changes === 1;
}
