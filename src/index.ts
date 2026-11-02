import {
  ApplicationCommandType,
  InteractionResponseType,
  InteractionType,
  type APIChatInputApplicationCommandInteraction,
  type APIInteraction,
} from "discord-api-types/v10";
import { reply, respond } from "./discord/api.ts";
import { verifySignature } from "./discord/verify.ts";
import { handleCommand } from "./handlers/command.ts";
import { handleAutocomplete } from "./handlers/autocomplete.ts";
import { handleComponent } from "./handlers/component.ts";
import { closeExpired } from "./handlers/cron.ts";

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
        if (interaction.data.type !== ApplicationCommandType.ChatInput)
          return reply("未対応のコマンドです", { ephemeral: true });
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
