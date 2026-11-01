import {
  InteractionResponseType,
  MessageFlags,
  type APIInteractionResponse,
  type APIInteractionResponseCallbackData,
  type RESTPatchAPIChannelMessageJSONBody,
  type RESTPostAPIChannelMessageJSONBody,
} from "discord-api-types/v10";

const API_BASE = "https://discord.com/api/v10";
const ORIGINAL_MESSAGE_ATTEMPTS = 3;
const ORIGINAL_MESSAGE_RETRY_MS = 1000;

export function respond(body: APIInteractionResponse): Response {
  return Response.json(body);
}

/** 押した人にだけ見えるメッセージ。メンションしても通知は飛ばさない */
export function ephemeralMessage(content: string): APIInteractionResponseCallbackData {
  return { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } };
}

export function reply(content: string, options: { ephemeral?: boolean } = {}): Response {
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: options.ephemeral ? ephemeralMessage(content) : { content, allowed_mentions: { parse: [] } },
  });
}

async function callApi(
  method: "PATCH" | "POST",
  path: string,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<void> {
  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    console.error(`Discord API ${method} ${path} failed: ${res.status} ${await res.text()}`);
  }
}

// interaction token で叩く webhook は bot token なしで使える。15 分有効
export function editOriginal(appId: string, token: string, body: APIInteractionResponseCallbackData): Promise<void> {
  return callApi("PATCH", `/webhooks/${appId}/${token}/messages/@original`, body);
}

export function followUp(appId: string, token: string, body: APIInteractionResponseCallbackData): Promise<void> {
  return callApi("POST", `/webhooks/${appId}/${token}`, body);
}

/** 応答した投稿の ID。応答直後はまだ作られておらず 404 になりうるので、待ってから数回試す */
export async function getOriginalMessageId(appId: string, token: string): Promise<string | null> {
  const path = `/webhooks/${appId}/${token}/messages/@original`;
  for (let attempt = 0; attempt < ORIGINAL_MESSAGE_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, ORIGINAL_MESSAGE_RETRY_MS));
    const res = await fetch(`${API_BASE}${path}`);
    if (res.ok) {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") return body.id;
      console.error(`Discord API GET ${path} returned no id`);
      return null;
    }
    if (res.status !== 404) {
      console.error(`Discord API GET ${path} failed: ${res.status} ${await res.text()}`);
      return null;
    }
  }
  console.error(`Discord API GET ${path} kept returning 404`);
  return null;
}

// interaction token が切れた後（⚙ の操作や Cron）でも書き換えられるよう、こちらは bot token を使う
export function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  body: RESTPatchAPIChannelMessageJSONBody,
): Promise<void> {
  return callApi("PATCH", `/channels/${channelId}/messages/${messageId}`, body, { Authorization: `Bot ${botToken}` });
}

export function createChannelMessage(
  botToken: string,
  channelId: string,
  body: RESTPostAPIChannelMessageJSONBody,
): Promise<void> {
  return callApi("POST", `/channels/${channelId}/messages`, body, { Authorization: `Bot ${botToken}` });
}
