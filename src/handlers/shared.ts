import type { APIMessageComponentInteraction } from "discord-api-types/v10";
import { followUp, ephemeralMessage, editChannelMessage } from "../discord/api.ts";
import { markNotified, readSnapshot } from "../db/recruitments.ts";
import type { Recruitment } from "../domain/recruitment.ts";
import { tallyRecruitment, type Participant } from "../domain/tally.ts";
import { renderBoard } from "../render/board.ts";
import { renderReadyNotice } from "../render/notices.ts";

export function userIdOf(interaction: {
  member?: { user: { id: string } };
  user?: { id: string };
}): string | undefined {
  return interaction.member?.user.id ?? interaction.user?.id;
}

export function runInBackground(ctx: ExecutionContext, label: string, task: Promise<unknown>): void {
  ctx.waitUntil(
    task.catch((err: unknown) => {
      console.error(`${label} failed`, err);
    }),
  );
}

export function runComponentTask(
  ctx: ExecutionContext,
  env: Env,
  interaction: APIMessageComponentInteraction,
  label: string,
  task: Promise<void>,
): void {
  ctx.waitUntil(
    task.catch(async (err: unknown) => {
      console.error(`${label} failed`, err);
      await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage("処理に失敗しました"));
    }),
  );
}

export async function notifyIfReady(
  env: Env,
  token: string,
  rec: Recruitment,
  participants: Participant[],
  now: Date,
): Promise<void> {
  const { outcome } = tallyRecruitment(rec, participants, now);
  if (outcome.kind !== "ready") return;
  if (await markNotified(env.DB, rec.id, outcome.ready)) {
    await followUp(env.DISCORD_APP_ID, token, renderReadyNotice(rec, outcome.ready));
  }
}

export async function publishEndedBoard(env: Env, recruitmentId: string, now: Date): Promise<boolean> {
  const snapshot = await readSnapshot(env.DB, recruitmentId);
  if (!snapshot) return false;
  const { rec, participants } = snapshot;
  if (!rec.messageId) {
    console.error(`recruitment ${rec.id} has no message_id; board was not updated`);
    return false;
  }
  return editChannelMessage(env.DISCORD_BOT_TOKEN, rec.channelId, rec.messageId, renderBoard(rec, participants, now));
}
