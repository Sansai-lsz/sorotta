import {
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponse,
  type APIInteractionResponseCallbackData,
} from "discord-api-types/v10";

const API_BASE = "https://discord.com/api/v10";

export function respond(body: APIInteractionResponse): Response {
  return Response.json(body);
}

export function reply(content: string, options: { ephemeral?: boolean } = {}): Response {
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: {
      content,
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
      allowed_mentions: { parse: [] },
    },
  });
}

// interaction token で叩く webhook は bot token なしで使える。15 分有効
async function callWebhook(
  method: "PATCH" | "POST",
  path: string,
  body: APIInteractionResponseCallbackData,
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
}

export function editOriginal(appId: string, token: string, body: APIInteractionResponseCallbackData): Promise<void> {
  return callWebhook("PATCH", `/webhooks/${appId}/${token}/messages/@original`, body);
}

export function followUp(appId: string, token: string, body: APIInteractionResponseCallbackData): Promise<void> {
  return callWebhook("POST", `/webhooks/${appId}/${token}`, body);
}
