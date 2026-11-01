import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  ComponentType,
  InteractionResponseType,
  InteractionType,
  MessageFlags,
  type APIApplicationCommandAutocompleteInteraction,
  type APIApplicationCommandInteractionDataOption,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { resolveAnswer, type AnswerAction, type AnswerOp, type AnswerResult } from "./answer.ts";
import { bucketOf, isScope, isScopeOver, openHours, planRecruitment, type Scope } from "./buckets.ts";
import { GAME_COMMAND, NOTIFY_OPTION, RECRUIT_COMMAND, SCOPE_OPTION, USAGE_COMMAND } from "./commands.ts";
import { parseCustomId, parseSelectValue, type ComponentAction } from "./customId.ts";
import { hoursSinceDateStart, gameToday, parseDateInput } from "./date.ts";
import {
  applyAnswer,
  createRecruitment,
  deleteGame,
  findGame,
  finishRecruitment,
  getRecruitment,
  listGames,
  listOpenRecruitmentsUntil,
  listParticipants,
  markNotified,
  readSnapshot,
  saveMessageId,
  searchGames,
  upsertGame,
} from "./db.ts";
import {
  createChannelMessage,
  editChannelMessage,
  editOriginal,
  ephemeralMessage,
  followUp,
  getOriginalMessageId,
  reply,
  respond,
} from "./discord.ts";
import type { Recruitment } from "./recruitment.ts";
import {
  endedNotice,
  gameLabel,
  renderBoard,
  renderCancelNotice,
  renderFinishResult,
  renderManagePanel,
  renderReadyNotice,
  withRoleMention,
} from "./render.ts";
import { checkNotifyRole, chooseNotifyRole, type RoleCheck } from "./notifyRole.ts";
import { cancelNoticeTargets, tallyRecruitment, type Participant } from "./tally.ts";
import { usageResponse } from "./usage.ts";
import { verifySignature } from "./verify.ts";

type Option = APIApplicationCommandInteractionDataOption;

const UNUSABLE = "このボタンは使えません";

function findOption(options: Option[] | undefined, name: string): Option | undefined {
  return options?.find((o) => o.name === name);
}

function stringOption(options: Option[] | undefined, name: string): string | undefined {
  const opt = findOption(options, name);
  return opt?.type === ApplicationCommandOptionType.String ? opt.value : undefined;
}

function integerOption(options: Option[] | undefined, name: string): number | undefined {
  const opt = findOption(options, name);
  return opt?.type === ApplicationCommandOptionType.Integer && typeof opt.value === "number" ? opt.value : undefined;
}

function roleOption(options: Option[] | undefined, name: string): string | undefined {
  const opt = findOption(options, name);
  return opt?.type === ApplicationCommandOptionType.Role ? opt.value : undefined;
}

function subcommand(options: Option[] | undefined): { name: string; options: Option[] | undefined } | undefined {
  const opt = options?.[0];
  return opt?.type === ApplicationCommandOptionType.Subcommand ? { name: opt.name, options: opt.options } : undefined;
}

function userIdOf(interaction: { member?: { user: { id: string } }; user?: { id: string } }): string | undefined {
  return interaction.member?.user.id ?? interaction.user?.id;
}

function runInBackground(ctx: ExecutionContext, label: string, task: Promise<unknown>): void {
  ctx.waitUntil(
    task.catch((err: unknown) => {
      console.error(`${label} failed`, err);
    }),
  );
}

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

async function notifyIfReady(
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

function roleSuffix(roleId: string | null): string {
  return roleId === null ? "" : `（通知: <@&${roleId}>）`;
}

function roleCheckOf(
  interaction: APIChatInputApplicationCommandInteraction,
  roleId: string | undefined,
  guildId: string,
): RoleCheck {
  if (roleId === undefined) return { ok: true, warning: null };
  return checkNotifyRole(roleId, guildId, interaction.data.resolved?.roles?.[roleId]?.mentionable);
}

async function handleGameCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  guildId: string,
): Promise<Response> {
  const sub = subcommand(interaction.data.options);
  switch (sub?.name) {
    case "add": {
      const name = stringOption(sub.options, "name")?.trim();
      const min = integerOption(sub.options, "players");
      const max = integerOption(sub.options, "max") ?? null;
      const roleInput = roleOption(sub.options, "role");
      if (!name || min === undefined) return reply("ゲーム名と人数を指定してください", { ephemeral: true });
      if (max !== null && max < min) return reply("定員は最少人数以上にしてください", { ephemeral: true });
      const roleCheck = roleCheckOf(interaction, roleInput, guildId);
      if (!roleCheck.ok) return reply(roleCheck.message, { ephemeral: true });
      const notifyRoleId = roleInput ?? null;
      const game = { name, min, max, notifyRoleId };
      await upsertGame(env.DB, guildId, game);
      const warning = roleCheck.warning === null ? "" : `\n⚠️ ${roleCheck.warning}`;
      return reply(`${gameLabel(game)}を登録しました${roleSuffix(notifyRoleId)}${warning}`);
    }
    case "list": {
      const games = await listGames(env.DB, guildId);
      if (games.length === 0) return reply("登録済みのゲームはありません。/game add で登録できます", { ephemeral: true });
      return reply(games.map((g) => `・${gameLabel(g)}${roleSuffix(g.notifyRoleId)}`).join("\n"), { ephemeral: true });
    }
    case "remove": {
      const name = stringOption(sub.options, "name") ?? "";
      const deleted = await deleteGame(env.DB, guildId, name);
      return deleted ? reply(`${name} の登録を消しました`) : reply(`${name} は登録されていません`, { ephemeral: true });
    }
    default:
      return reply("不明なサブコマンドです", { ephemeral: true });
  }
}

function hostJoin(scope: Scope, date: string, now: Date): AnswerOp | null {
  if (scope === "any") return { kind: "toggleAnytime" };
  const hour = openHours(bucketOf(scope), hoursSinceDateStart(date, now))[0];
  return hour === undefined ? null : { kind: "slot", bucket: scope, hour, now: false };
}

async function handleRecruitCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  ctx: ExecutionContext,
  guildId: string,
): Promise<Response> {
  const options = interaction.data.options;
  const gameName = stringOption(options, "game") ?? "";
  const game = await findGame(env.DB, guildId, gameName);
  if (!game) {
    return reply(`「${gameName}」は登録されていません。先に /game add で登録してください`, { ephemeral: true });
  }
  const scopeInput = stringOption(options, SCOPE_OPTION);
  if (scopeInput !== undefined && !isScope(scopeInput)) {
    return reply(`時間帯「${scopeInput}」は指定できません`, { ephemeral: true });
  }
  const now = new Date();
  const dateInput = stringOption(options, "date");
  const date = parseDateInput(dateInput, now);
  if (!date) return reply(`日付「${dateInput}」を読み取れませんでした。11/3 や 明日 の形で指定してください`, { ephemeral: true });
  const plan = planRecruitment({ date, scope: scopeInput }, now);
  const host = plan.ok ? hostJoin(plan.scope, plan.date, now) : null;
  if (!plan.ok || !host) {
    return reply("指定した時間帯はもう終わっています。別の時間帯か日付を指定してください", { ephemeral: true });
  }
  const hostId = userIdOf(interaction);
  if (!hostId) return reply("ユーザーを特定できませんでした", { ephemeral: true });
  const roleInput = roleOption(options, NOTIFY_OPTION);
  const roleCheck = roleCheckOf(interaction, roleInput, guildId);
  if (!roleCheck.ok) return reply(roleCheck.message, { ephemeral: true });

  const rec: Recruitment = {
    id: interaction.id,
    guildId,
    channelId: interaction.channel.id,
    messageId: null,
    game: game.name,
    min: game.min,
    max: game.max,
    date: plan.date,
    scope: plan.scope,
    hostId,
    status: "open",
    notifiedSlot: null,
  };
  await createRecruitment(env.DB, rec, host);
  const snapshot = await readSnapshot(env.DB, rec.id);
  if (!snapshot) return reply("募集を作れませんでした", { ephemeral: true });

  runInBackground(
    ctx,
    "afterRecruit",
    // 元の応答が Discord に届く前に followUp すると失敗し、markNotified 済みのため通知が失われる
    (async () => {
      const messageId = await getOriginalMessageId(env.DISCORD_APP_ID, interaction.token);
      if (messageId) await saveMessageId(env.DB, rec.id, messageId);
      if (roleCheck.warning !== null) {
        await followUp(env.DISCORD_APP_ID, interaction.token, ephemeralMessage(roleCheck.warning));
      }
      await notifyIfReady(env, interaction.token, snapshot.rec, snapshot.participants, now);
    })(),
  );
  const notifyRoleId = chooseNotifyRole(roleInput, game.notifyRoleId);
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: withRoleMention(renderBoard(snapshot.rec, snapshot.participants, now), game.name, notifyRoleId),
  });
}

async function handleCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) return reply("サーバー内で使ってください", { ephemeral: true });
  switch (interaction.data.name) {
    case GAME_COMMAND:
      return handleGameCommand(interaction, env, guildId);
    case RECRUIT_COMMAND:
      return handleRecruitCommand(interaction, env, ctx, guildId);
    case USAGE_COMMAND:
      return usageResponse();
    default:
      return reply("不明なコマンドです", { ephemeral: true });
  }
}

function focusedValue(options: Option[] | undefined): string | undefined {
  for (const opt of options ?? []) {
    if (opt.type === ApplicationCommandOptionType.Subcommand) {
      const nested = focusedValue(opt.options);
      if (nested !== undefined) return nested;
    } else if (opt.type === ApplicationCommandOptionType.String && opt.focused) {
      return opt.value;
    }
  }
  return undefined;
}

async function handleAutocomplete(interaction: APIApplicationCommandAutocompleteInteraction, env: Env): Promise<Response> {
  const guildId = interaction.guild_id;
  const games = guildId ? await searchGames(env.DB, guildId, focusedValue(interaction.data.options) ?? "") : [];
  return respond({
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices: games.map((g) => ({ name: gameLabel(g), value: g.name })) },
  });
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
  await editOriginal(env.DISCORD_APP_ID, interaction.token, renderBoard(snapshot.rec, snapshot.participants, now));

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

async function publishEndedBoard(env: Env, recruitmentId: string, now: Date): Promise<boolean> {
  const snapshot = await readSnapshot(env.DB, recruitmentId);
  if (!snapshot) return false;
  const { rec, participants } = snapshot;
  if (!rec.messageId) {
    console.error(`recruitment ${rec.id} has no message_id; board was not updated`);
    return false;
  }
  return editChannelMessage(env.DISCORD_BOT_TOKEN, rec.channelId, rec.messageId, renderBoard(rec, participants, now));
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
    await editOriginal(env.DISCORD_APP_ID, interaction.token, { content: "この募集はもう終わっています", components: [] });
    return;
  }
  const board = await publishEndedBoard(env, rec.id, new Date());
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

async function handleComponent(
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
    case "close":
    case "cancel":
      runComponentTask(
        ctx,
        env,
        interaction,
        "finishFromPanel",
        finishFromPanel(interaction, env, action.recruitmentId, userId, action.kind === "close" ? "closed" : "cancelled"),
      );
      return respond({ type: InteractionResponseType.DeferredMessageUpdate });
    default: {
      const answer = toAnswerAction(action, interaction);
      if (!answer) return reply(UNUSABLE, { ephemeral: true });
      // D1 の読み書きと再描画が 3 秒の応答期限に収まらないことがあるので、先に受け付けだけ返す
      runComponentTask(ctx, env, interaction, "updateBoard", updateBoard(interaction, env, action.recruitmentId, userId, answer));
      return respond({ type: InteractionResponseType.DeferredMessageUpdate });
    }
  }
}

async function closeExpired(env: Env, now: Date): Promise<void> {
  const recs = await listOpenRecruitmentsUntil(env.DB, gameToday(now));
  const failed: string[] = [];
  for (const rec of recs) {
    if (!isScopeOver(rec.scope, hoursSinceDateStart(rec.date, now))) continue;
    try {
      if (!(await finishRecruitment(env.DB, rec.id, "closed"))) continue;
      if (!(await publishEndedBoard(env, rec.id, now))) failed.push(rec.id);
    } catch (err: unknown) {
      console.error(`closeExpired ${rec.id} failed`, err);
      failed.push(rec.id);
    }
  }
  if (failed.length > 0) throw new Error(`closeExpired failed for ${failed.join(", ")}`);
}

export default {
  async fetch(request, env, ctx): Promise<Response> {
    if (request.method !== "POST") return new Response("Not Found", { status: 404 });

    const signature = request.headers.get("X-Signature-Ed25519");
    const timestamp = request.headers.get("X-Signature-Timestamp");
    const body = await request.text();
    if (!signature || !timestamp || !(await verifySignature(env.DISCORD_PUBLIC_KEY, signature, timestamp, body))) {
      return new Response("Bad request signature", { status: 401 });
    }

    const interaction = JSON.parse(body) as APIInteraction;
    switch (interaction.type) {
      case InteractionType.Ping:
        return respond({ type: InteractionResponseType.Pong });
      case InteractionType.ApplicationCommand:
        if (interaction.data.type !== ApplicationCommandType.ChatInput) return reply("未対応のコマンドです", { ephemeral: true });
        return handleCommand(interaction as APIChatInputApplicationCommandInteraction, env, ctx);
      case InteractionType.ApplicationCommandAutocomplete:
        return handleAutocomplete(interaction, env);
      case InteractionType.MessageComponent:
        return handleComponent(interaction, env, ctx);
      default:
        return new Response("Unsupported interaction", { status: 400 });
    }
  },

  async scheduled(controller, env): Promise<void> {
    await closeExpired(env, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<Env>;
