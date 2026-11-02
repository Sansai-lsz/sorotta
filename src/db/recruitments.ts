import type { AnswerOp } from "../domain/answer.ts";
import { isBucketKey, isScope, type BucketKey } from "../domain/buckets.ts";
import { isRecruitmentStatus, type ReadySlot, type Recruitment } from "../domain/recruitment.ts";
import type { Participant, Slot } from "../domain/tally.ts";

type Row = Record<string, unknown>;

function text(row: Row, key: string): string {
  const value = row[key];
  if (typeof value !== "string") throw new Error(`expected text in ${key}: ${String(value)}`);
  return value;
}

function integer(row: Row, key: string): number {
  const value = row[key];
  if (typeof value !== "number") throw new Error(`expected integer in ${key}: ${String(value)}`);
  return value;
}

function nullable<T>(row: Row, key: string, read: (row: Row, key: string) => T): T | null {
  return row[key] === null ? null : read(row, key);
}

const RECRUITMENT_COLUMNS =
  "id, guild_id AS guildId, channel_id AS channelId, message_id AS messageId, game, required AS min, max_players AS max, date, scope, recruiter_id AS hostId, notify_role_id AS notifyRoleId, status, ready_bucket AS readyBucket, ready_hour AS readyHour";

function parseRecruitment(row: Row): Recruitment {
  const id = text(row, "id");
  const scope = text(row, "scope");
  const status = text(row, "status");
  const readyBucket = nullable(row, "readyBucket", text);
  const readyHour = nullable(row, "readyHour", integer);
  if (!isScope(scope) || !isRecruitmentStatus(status)) {
    throw new Error(`invalid recruitment row ${id}: scope=${scope} status=${status}`);
  }
  let notifiedSlot: ReadySlot | null = null;
  if (readyBucket !== null && readyHour !== null) {
    if (!isBucketKey(readyBucket)) throw new Error(`invalid recruitment row ${id}: ready_bucket=${readyBucket}`);
    notifiedSlot = { bucket: readyBucket, hour: readyHour };
  }
  return {
    id,
    guildId: text(row, "guildId"),
    channelId: text(row, "channelId"),
    messageId: nullable(row, "messageId", text),
    game: text(row, "game"),
    min: integer(row, "min"),
    max: nullable(row, "max", integer),
    date: text(row, "date"),
    scope,
    hostId: text(row, "hostId"),
    notifyRoleId: nullable(row, "notifyRoleId", text),
    status,
    notifiedSlot,
  };
}

function parseParticipants(participantRows: Row[], slotRows: Row[]): Participant[] {
  const slotsByUser = new Map<string, Partial<Record<BucketKey, Slot>>>();
  for (const row of slotRows) {
    const userId = text(row, "userId");
    const bucket = text(row, "bucket");
    if (!isBucketKey(bucket)) throw new Error(`invalid slot bucket for ${userId}: ${bucket}`);
    const userSlots = slotsByUser.get(userId) ?? {};
    userSlots[bucket] = { hour: integer(row, "hour"), now: integer(row, "isNow") === 1 };
    slotsByUser.set(userId, userSlots);
  }
  return participantRows.map((row): Participant => {
    const userId = text(row, "userId");
    return integer(row, "passed") === 1
      ? { userId, passed: true }
      : { userId, passed: false, anytime: integer(row, "anytime") === 1, slots: slotsByUser.get(userId) ?? {} };
  });
}

function recruitmentStatement(db: D1Database, id: string): D1PreparedStatement {
  return db.prepare(`SELECT ${RECRUITMENT_COLUMNS} FROM recruitments WHERE id = ?`).bind(id);
}

function participantsStatements(db: D1Database, recruitmentId: string): D1PreparedStatement[] {
  return [
    db
      .prepare("SELECT user_id AS userId, passed, anytime FROM participants WHERE recruitment_id = ? ORDER BY id")
      .bind(recruitmentId),
    db
      .prepare("SELECT user_id AS userId, bucket, hour, is_now AS isNow FROM slots WHERE recruitment_id = ?")
      .bind(recruitmentId),
  ];
}

function rowsAt(results: D1Result<Row>[], index: number): Row[] {
  const result = results[index];
  if (!result) throw new Error(`missing batch result ${index}`);
  return result.results;
}

// 締め切った募集への回答を書かないよう、すべての書き込みに受付中であることを条件として付ける
const WHILE_OPEN = "EXISTS (SELECT 1 FROM recruitments WHERE id = ? AND status = 'open')";

function answerStatements(db: D1Database, recruitmentId: string, userId: string, op: AnswerOp): D1PreparedStatement[] {
  const ensure = db
    .prepare(
      `INSERT INTO participants (recruitment_id, user_id) SELECT ?, ? WHERE ${WHILE_OPEN} ON CONFLICT DO NOTHING`,
    )
    .bind(recruitmentId, userId, recruitmentId);
  const updateParticipant = (set: string) =>
    db
      .prepare(`UPDATE participants SET ${set} WHERE recruitment_id = ? AND user_id = ? AND ${WHILE_OPEN}`)
      .bind(recruitmentId, userId, recruitmentId);
  switch (op.kind) {
    case "slot":
      return [
        ensure,
        updateParticipant("passed = 0"),
        db
          .prepare(
            `INSERT INTO slots (recruitment_id, user_id, bucket, hour, is_now) SELECT ?, ?, ?, ?, ? WHERE ${WHILE_OPEN} ON CONFLICT (recruitment_id, user_id, bucket) DO UPDATE SET hour = excluded.hour, is_now = excluded.is_now`,
          )
          .bind(recruitmentId, userId, op.bucket, op.hour, op.now ? 1 : 0, recruitmentId),
      ];
    case "clear":
      return [
        ensure,
        db
          .prepare(`DELETE FROM slots WHERE recruitment_id = ? AND user_id = ? AND bucket = ? AND ${WHILE_OPEN}`)
          .bind(recruitmentId, userId, op.bucket, recruitmentId),
      ];
    case "toggleAnytime":
      return [ensure, updateParticipant("anytime = 1 - anytime, passed = 0")];
    case "pass":
      return [
        ensure,
        updateParticipant("passed = 1, anytime = 0"),
        db
          .prepare(`DELETE FROM slots WHERE recruitment_id = ? AND user_id = ? AND ${WHILE_OPEN}`)
          .bind(recruitmentId, userId, recruitmentId),
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
        "INSERT INTO recruitments (id, guild_id, channel_id, message_id, game, required, max_players, date, scope, recruiter_id, notify_role_id, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
      .bind(
        rec.id,
        rec.guildId,
        rec.channelId,
        rec.messageId,
        rec.game,
        rec.min,
        rec.max,
        rec.date,
        rec.scope,
        rec.hostId,
        rec.notifyRoleId,
        rec.status,
      ),
    ...answerStatements(db, rec.id, rec.hostId, hostJoin),
  ]);
}

export async function getRecruitment(db: D1Database, id: string): Promise<Recruitment | null> {
  const row = await recruitmentStatement(db, id).first<Row>();
  return row ? parseRecruitment(row) : null;
}

export async function listOpenRecruitmentsUntil(db: D1Database, date: string): Promise<Recruitment[]> {
  const { results } = await db
    .prepare(`SELECT ${RECRUITMENT_COLUMNS} FROM recruitments WHERE status = 'open' AND date <= ?`)
    .bind(date)
    .all<Row>();
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

export async function listParticipants(db: D1Database, recruitmentId: string): Promise<Participant[]> {
  const results = await db.batch<Row>(participantsStatements(db, recruitmentId));
  return parseParticipants(rowsAt(results, 0), rowsAt(results, 1));
}

export type Snapshot = { rec: Recruitment; participants: Participant[] };

// D1 は batch を 1 つのトランザクションで実行するので、募集と参加者が同じ時点の状態になる
export async function readSnapshot(db: D1Database, recruitmentId: string): Promise<Snapshot | null> {
  const results = await db.batch<Row>([
    recruitmentStatement(db, recruitmentId),
    ...participantsStatements(db, recruitmentId),
  ]);
  const row = rowsAt(results, 0)[0];
  if (!row) return null;
  return { rec: parseRecruitment(row), participants: parseParticipants(rowsAt(results, 1), rowsAt(results, 2)) };
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
