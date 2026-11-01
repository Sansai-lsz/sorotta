import {
  ApplicationCommandOptionType,
  ApplicationCommandType,
  InteractionResponseType,
  InteractionType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIApplicationCommandInteractionDataOption,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
  type APIMessageComponentInteraction,
} from "discord-api-types/v10";
import { GAME_COMMAND, RECRUIT_COMMAND } from "./commands.ts";
import { parseDateInput } from "./date.ts";
import {
  createRecruitment,
  deleteGame,
  findGame,
  getRecruitment,
  listEntries,
  listGames,
  markNotified,
  searchGames,
  upsertEntry,
  upsertGame,
} from "./db.ts";
import { editOriginal, followUp, reply, respond } from "./discord.ts";
import { parseCustomId, renderBoard, renderReadyNotice } from "./render.ts";
import { isValidHour, tally } from "./tally.ts";
import { verifySignature } from "./verify.ts";

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

function subcommand(options: Option[] | undefined): { name: string; options: Option[] | undefined } | undefined {
  const opt = options?.[0];
  return opt?.type === ApplicationCommandOptionType.Subcommand ? { name: opt.name, options: opt.options } : undefined;
}

function userIdOf(interaction: { member?: { user: { id: string } }; user?: { id: string } }): string | undefined {
  return interaction.member?.user.id ?? interaction.user?.id;
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
      const required = integerOption(sub.options, "players");
      if (!name || required === undefined) return reply("ゲーム名と人数を指定してください", { ephemeral: true });
      await upsertGame(env.DB, guildId, { name, required });
      return reply(`${name}（${required}人〜）を登録しました`);
    }
    case "list": {
      const games = await listGames(env.DB, guildId);
      if (games.length === 0) return reply("登録済みのゲームはありません。/game add で登録できます", { ephemeral: true });
      return reply(games.map((g) => `・${g.name}（${g.required}人〜）`).join("\n"), { ephemeral: true });
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

async function handleRecruitCommand(
  interaction: APIChatInputApplicationCommandInteraction,
  env: Env,
  guildId: string,
): Promise<Response> {
  const options = interaction.data.options;
  const gameName = stringOption(options, "game") ?? "";
  const game = await findGame(env.DB, guildId, gameName);
  if (!game) {
    return reply(`「${gameName}」は登録されていません。先に /game add で登録してください`, { ephemeral: true });
  }
  const dateInput = stringOption(options, "date");
  const date = parseDateInput(dateInput, new Date());
  if (!date) return reply(`日付「${dateInput}」を読み取れませんでした。11/3 や 明日 の形で指定してください`, { ephemeral: true });
  const recruiterId = userIdOf(interaction);
  if (!recruiterId) return reply("ユーザーを特定できませんでした", { ephemeral: true });

  const rec = { id: interaction.id, game: game.name, required: game.required, date, recruiterId };
  await createRecruitment(env.DB, { ...rec, guildId, channelId: interaction.channel.id });
  return respond({ type: InteractionResponseType.ChannelMessageWithSource, data: renderBoard(rec, []) });
}

async function handleCommand(interaction: APIChatInputApplicationCommandInteraction, env: Env): Promise<Response> {
  const guildId = interaction.guild_id;
  if (!guildId) return reply("サーバー内で使ってください", { ephemeral: true });
  switch (interaction.data.name) {
    case GAME_COMMAND:
      return handleGameCommand(interaction, env, guildId);
    case RECRUIT_COMMAND:
      return handleRecruitCommand(interaction, env, guildId);
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
    data: { choices: games.map((g) => ({ name: `${g.name}（${g.required}人〜）`, value: g.name })) },
  });
}

async function updateBoard(
  interaction: APIMessageComponentInteraction,
  env: Env,
  recruitmentId: string,
  userId: string,
  hour: number | null,
): Promise<void> {
  const rec = await getRecruitment(env.DB, recruitmentId);
  if (!rec) return;
  await upsertEntry(env.DB, recruitmentId, { userId, hour });
  const entries = await listEntries(env.DB, recruitmentId);
  await editOriginal(env.DISCORD_APP_ID, interaction.token, renderBoard(rec, entries));

  const { ready } = tally(entries, rec.required);
  if (ready && (await markNotified(env.DB, recruitmentId))) {
    await followUp(env.DISCORD_APP_ID, interaction.token, renderReadyNotice(rec.game, ready.hour, ready.userIds));
  }
}

function handleComponent(interaction: APIMessageComponentInteraction, env: Env, ctx: ExecutionContext): Response {
  const action = parseCustomId(interaction.data.custom_id);
  const userId = userIdOf(interaction);
  if (!action || !userId || (action.kind === "join" && !isValidHour(action.hour))) {
    return reply("このボタンは使えません", { ephemeral: true });
  }
  const hour = action.kind === "join" ? action.hour : null;
  // D1 の読み書きと再描画が 3 秒の応答期限に収まらないことがあるので、先に受け付けだけ返す
  ctx.waitUntil(
    updateBoard(interaction, env, action.recruitmentId, userId, hour).catch((err: unknown) => {
      console.error("updateBoard failed", err);
    }),
  );
  return respond({ type: InteractionResponseType.DeferredMessageUpdate });
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
        return handleCommand(interaction as APIChatInputApplicationCommandInteraction, env);
      case InteractionType.ApplicationCommandAutocomplete:
        return handleAutocomplete(interaction, env);
      case InteractionType.MessageComponent:
        return handleComponent(interaction, env, ctx);
      default:
        return new Response("Unsupported interaction", { status: 400 });
    }
  },
} satisfies ExportedHandler<Env>;
