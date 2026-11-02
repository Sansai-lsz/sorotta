import {
  ApplicationCommandOptionType,
  InteractionResponseType,
  type APIApplicationCommandAutocompleteInteraction,
  type APIApplicationCommandInteractionDataOption,
} from "discord-api-types/v10";
import { searchGames } from "../db/games.ts";
import { respond } from "../discord/api.ts";
import { gameLabel } from "../render/board.ts";

type Option = APIApplicationCommandInteractionDataOption;

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

export async function handleAutocomplete(
  interaction: APIApplicationCommandAutocompleteInteraction,
  env: Env,
): Promise<Response> {
  const guildId = interaction.guild_id;
  const games = guildId ? await searchGames(env.DB, guildId, focusedValue(interaction.data.options) ?? "") : [];
  return respond({
    type: InteractionResponseType.ApplicationCommandAutocompleteResult,
    data: { choices: games.map((g) => ({ name: gameLabel(g), value: g.name })) },
  });
}
