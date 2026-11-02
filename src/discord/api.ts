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

export function ephemeralMessage(content: string): APIInteractionResponseCallbackData {
  return { content, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } };
}

export function reply(content: string, options: { ephemeral?: boolean } = {}): Response {
  return respond({
    type: InteractionResponseType.ChannelMessageWithSource,
    data: options.ephemeral ? ephemeralMessage(content) : { content, allowed_mentions: { parse: [] } },
  });
}

type Endpoint = { path: string; logPath: string };

// interaction token は 15 分間だれでも投稿できる鍵なので、ログには残さない
function webhook(appId: string, token: string, suffix = ""): Endpoint {
  return { path: `/webhooks/${appId}/${token}${suffix}`, logPath: `/webhooks/${appId}/***${suffix}` };
}

async function callApi(
  method: "PATCH" | "POST",
  endpoint: Endpoint,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}${endpoint.path}`, {
      method,
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
    });
    if (res.ok) return true;
    console.error(`Discord API ${method} ${endpoint.logPath} failed: ${res.status} ${await res.text()}`);
  } catch (err: unknown) {
    console.error(`Discord API ${method} ${endpoint.logPath} failed`, err);
  }
  return false;
}

// interaction token で叩く webhook は bot token なしで使える。15 分有効
export function editOriginal(appId: string, token: string, body: RESTPatchAPIChannelMessageJSONBody): Promise<boolean> {
  return callApi("PATCH", webhook(appId, token, "/messages/@original"), body);
}

export function followUp(appId: string, token: string, body: APIInteractionResponseCallbackData): Promise<boolean> {
  return callApi("POST", webhook(appId, token), body);
}

// 応答直後は投稿がまだ作られておらず 404 になりうるので、間を置いて数回試す
export async function getOriginalMessageId(appId: string, token: string): Promise<string | null> {
  const { path, logPath } = webhook(appId, token, "/messages/@original");
  for (let attempt = 1; attempt <= ORIGINAL_MESSAGE_ATTEMPTS; attempt++) {
    const res = await fetch(`${API_BASE}${path}`);
    if (res.ok) {
      const body: unknown = await res.json();
      if (typeof body === "object" && body !== null && "id" in body && typeof body.id === "string") return body.id;
      console.error(`Discord API GET ${logPath} returned no id`);
      return null;
    }
    if (res.status !== 404) {
      console.error(`Discord API GET ${logPath} failed: ${res.status} ${await res.text()}`);
      return null;
    }
    if (attempt < ORIGINAL_MESSAGE_ATTEMPTS) {
      await new Promise((resolve) => setTimeout(resolve, ORIGINAL_MESSAGE_RETRY_MS));
    }
  }
  console.error(`Discord API GET ${logPath} kept returning 404`);
  return null;
}

function channelEndpoint(path: string): Endpoint {
  return { path, logPath: path };
}

// interaction token が切れた後（⚙ の操作や Cron）でも書き換えられるよう、こちらは bot token を使う
export function editChannelMessage(
  botToken: string,
  channelId: string,
  messageId: string,
  body: RESTPatchAPIChannelMessageJSONBody,
): Promise<boolean> {
  return callApi("PATCH", channelEndpoint(`/channels/${channelId}/messages/${messageId}`), body, {
    Authorization: `Bot ${botToken}`,
  });
}

export function createChannelMessage(
  botToken: string,
  channelId: string,
  body: RESTPostAPIChannelMessageJSONBody,
): Promise<boolean> {
  return callApi("POST", channelEndpoint(`/channels/${channelId}/messages`), body, {
    Authorization: `Bot ${botToken}`,
  });
}
