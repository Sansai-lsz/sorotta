import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandInteractionDataOption,
  type APIChatInputApplicationCommandInteraction,
} from "discord-api-types/v10";
import { bucketOf, isScope, openHours, planRecruitment, type Scope } from "../domain/buckets.ts";
import { hoursSinceDateStart, parseDateInput } from "../domain/date.ts";
import { createRecruitment, readSnapshot, saveMessageId } from "../db/recruitments.ts";
import { deleteGame, findGame, listGames, upsertGame } from "../db/games.ts";
import { GAME_COMMAND, NOTIFY_OPTION, RECRUIT_COMMAND, SCOPE_OPTION, USAGE_COMMAND } from "../discord/commands.ts";
import { ephemeralMessage, followUp, getOriginalMessageId, reply, respond } from "../discord/api.ts";
import type { AnswerOp } from "../domain/answer.ts";
import type { Recruitment } from "../domain/recruitment.ts";
import { checkNotifyRole, chooseNotifyRole, type RoleCheck } from "../domain/notifyRole.ts";
import { gameLabel, renderBoard } from "../render/board.ts";
import { withRoleMention } from "../render/notices.ts";
import { usageResponse } from "../render/usage.ts";
import { notifyIfReady, runInBackground, userIdOf } from "./shared.ts";

type Option = APIApplicationCommandInteractionDataOption;

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
      if (games.length === 0)
        return reply("登録済みのゲームはありません。/game add で登録できます", { ephemeral: true });
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
  if (!date)
    return reply(`日付「${dateInput}」を読み取れませんでした。11/3 や 明日 の形で指定してください`, {
      ephemeral: true,
    });
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

export async function handleCommand(
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
