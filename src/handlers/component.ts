import {
  ComponentType,
  InteractionResponseType,
  MessageFlags,
  type APIMessageComponentInteraction,
  type APITextDisplayComponent,
} from "discord-api-types/v10";
import { resolveAnswer, resolveUndo, type AnswerAction, type AnswerResult, type UndoTarget } from "../domain/answer.ts";
import { hoursSinceDateStart } from "../domain/date.ts";
import {
  applyAnswer,
  finishRecruitment,
  getRecruitment,
  listParticipants,
  readSnapshot,
  saveMessageId,
} from "../db/recruitments.ts";
import { createChannelMessage, editOriginal, ephemeralMessage, followUp, reply, respond } from "../discord/api.ts";
import { parseCustomId, parseSelectValue, type ComponentAction } from "../discord/customId.ts";
import { cancelNoticeTargets, type Participant } from "../domain/tally.ts";
import { boardEditPayload } from "../render/board.ts";
import {
  endedNotice,
  renderCancelNotice,
  renderFinishResult,
  renderManagePanel,
  renderUndoPanel,
} from "../render/notices.ts";
import { notifyIfReady, publishBoard, runInBackground, userIdOf } from "./shared.ts";

const UNUSABLE = "このボタンは使えません";

function runComponentTask(
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

async function updateBoard(
  interaction: APIMessageComponentInteraction,
  env: Env,
  recruitmentId: string,
  userId: string,
  action: AnswerAction,
): Promise<void> {
  const rec = await getRecruitment(env.DB, recruitmentId);
  if (!rec) {
    await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage(UNUSABLE));
    return;
  }
  if (rec.messageId === null) await saveMessageId(env.DB, rec.id, interaction.message.id);
  const now = new Date();

  const result: AnswerResult =
    rec.status === "open"
      ? resolveAnswer(action, rec, hoursSinceDateStart(rec.date, now))
      : { ok: false, message: endedNotice(rec.status) };
  if (result.ok) await applyAnswer(env.DB, rec.id, userId, result.op);

  const snapshot = await readSnapshot(env.DB, rec.id);
  if (!snapshot) {
    await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage(UNUSABLE));
    return;
  }
  await editOriginal(env.DISCORD_APP_ID, interaction.token, boardEditPayload(snapshot.rec, snapshot.participants, now));

  const refusal = !result.ok
    ? result.message
    : snapshot.rec.status !== "open"
      ? endedNotice(snapshot.rec.status)
      : null;
  if (refusal !== null) {
    await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage(refusal));
    return;
  }
  await notifyIfReady(env, interaction.token, snapshot.rec, snapshot.participants, now);
}

async function finishFromPanel(
  interaction: APIMessageComponentInteraction,
  env: Env,
  recruitmentId: string,
  userId: string,
  status: "closed" | "cancelled",
): Promise<void> {
  const rec = await getRecruitment(env.DB, recruitmentId);
  if (!rec || rec.hostId !== userId) return;
  if (!(await finishRecruitment(env.DB, rec.id, status))) {
    await editOriginal(env.DISCORD_APP_ID, interaction.token, {
      content: "この募集はもう終わっています",
      components: [],
    });
    return;
  }
  const board = await publishBoard(env, rec.id, new Date());
  let notice = true;
  if (status === "cancelled") {
    const targets = cancelNoticeTargets(rec, await listParticipants(env.DB, rec.id));
    if (targets.length > 0) {
      notice = await createChannelMessage(env.DISCORD_BOT_TOKEN, rec.channelId, renderCancelNotice(rec, targets));
    }
  }
  await editOriginal(env.DISCORD_APP_ID, interaction.token, {
    content: renderFinishResult(status, { board, notice }),
    components: [],
  });
}

async function openManagePanel(
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: ExecutionContext,
  recruitmentId: string,
  userId: string,
): Promise<Response> {
  const rec = await getRecruitment(env.DB, recruitmentId);
  if (!rec) return reply(UNUSABLE, { ephemeral: true });
  if (rec.messageId === null) {
    runInBackground(ctx, "saveMessageId", saveMessageId(env.DB, rec.id, interaction.message.id));
  }
  if (rec.status !== "open") return reply("この募集はもう終わっています", { ephemeral: true });
  if (rec.hostId !== userId) return reply(`募集した人（<@${rec.hostId}>）だけが操作できます`, { ephemeral: true });
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: { ...renderManagePanel(rec), flags: MessageFlags.Ephemeral },
  });
}

async function openUndoPanel(
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: ExecutionContext,
  recruitmentId: string,
  userId: string,
): Promise<Response> {
  const snapshot = await readSnapshot(env.DB, recruitmentId);
  if (!snapshot) return reply(UNUSABLE, { ephemeral: true });
  const { rec, participants } = snapshot;
  if (rec.messageId === null) {
    runInBackground(ctx, "saveMessageId", saveMessageId(env.DB, rec.id, interaction.message.id));
  }
  if (rec.status !== "open") return reply(endedNotice(rec.status), { ephemeral: true });
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      ...renderUndoPanel(rec, answerOf(participants, userId)),
      flags: MessageFlags.Ephemeral | MessageFlags.IsComponentsV2,
    },
  });
}

function answerOf(participants: Participant[], userId: string): Participant | undefined {
  return participants.find((p) => p.userId === userId);
}

// 取り消しパネルは Components V2 なので、文言だけに差し替えるときも TextDisplay で送る
function textPanel(content: string): { components: [APITextDisplayComponent] } {
  return { components: [{ type: ComponentType.TextDisplay, content }] };
}

async function undoFromPanel(
  interaction: APIMessageComponentInteraction,
  env: Env,
  recruitmentId: string,
  userId: string,
  target: UndoTarget,
): Promise<void> {
  const rec = await getRecruitment(env.DB, recruitmentId);
  if (!rec) {
    await editOriginal(env.DISCORD_APP_ID, interaction.token, textPanel(UNUSABLE));
    return;
  }
  if (rec.status !== "open") {
    await editOriginal(env.DISCORD_APP_ID, interaction.token, textPanel(endedNotice(rec.status)));
    return;
  }
  const result = resolveUndo(target, rec);
  if (!result.ok) {
    await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage(UNUSABLE));
    return;
  }
  await applyAnswer(env.DB, rec.id, userId, result.op);
  const now = new Date();
  const snapshot = await readSnapshot(env.DB, rec.id);
  if (!snapshot) return;
  const { rec: latest, participants } = snapshot;
  await editOriginal(
    env.DISCORD_APP_ID,
    interaction.token,
    latest.status === "open"
      ? renderUndoPanel(latest, answerOf(participants, userId))
      : textPanel(endedNotice(latest.status)),
  );
  if (!(await publishBoard(env, rec.id, now))) {
    await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage("盤面を書き換えられませんでした"));
    return;
  }
  if (latest.status === "open") await notifyIfReady(env, interaction.token, latest, participants, now);
}

function toAnswerAction(
  action: Extract<ComponentAction, { kind: "hour" | "now" | "select" | "anytime" | "pass" }>,
  interaction: APIMessageComponentInteraction,
): AnswerAction | null {
  switch (action.kind) {
    case "hour":
      return { kind: "hour", hour: action.hour };
    case "now":
      return { kind: "now", bucket: action.bucket };
    case "select": {
      const data = interaction.data;
      const raw = data.component_type === ComponentType.StringSelect ? data.values[0] : undefined;
      const value = raw === undefined ? null : parseSelectValue(raw);
      return value ? { kind: "select", bucket: action.bucket, value } : null;
    }
    case "anytime":
      return { kind: "anytime" };
    case "pass":
      return { kind: "pass" };
  }
}

export async function handleComponent(
  interaction: APIMessageComponentInteraction,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const action = parseCustomId(interaction.data.custom_id);
  const userId = userIdOf(interaction);
  if (!action || !userId) return reply(UNUSABLE, { ephemeral: true });

  switch (action.kind) {
    case "gear":
      return openManagePanel(interaction, env, ctx, action.recruitmentId, userId);
    case "manageAnswers":
      return openUndoPanel(interaction, env, ctx, action.recruitmentId, userId);
    case "undo":
      runComponentTask(
        ctx,
        env,
        interaction,
        "undoFromPanel",
        undoFromPanel(interaction, env, action.recruitmentId, userId, action.target),
      );
      return respond({ type: InteractionResponseType.DeferredMessageUpdate });
    case "close":
    case "cancel":
      runComponentTask(
        ctx,
        env,
        interaction,
        "finishFromPanel",
        finishFromPanel(
          interaction,
          env,
          action.recruitmentId,
          userId,
          action.kind === "close" ? "closed" : "cancelled",
        ),
      );
      return respond({ type: InteractionResponseType.DeferredMessageUpdate });
    default: {
      const answer = toAnswerAction(action, interaction);
      if (!answer) return reply(UNUSABLE, { ephemeral: true });
      // D1 の読み書きと再描画が 3 秒の応答期限に収まらないことがあるので、先に受け付けだけ返す
      runComponentTask(
        ctx,
        env,
        interaction,
        "updateBoard",
        updateBoard(interaction, env, action.recruitmentId, userId, answer),
      );
      return respond({ type: InteractionResponseType.DeferredMessageUpdate });
    }
  }
}
