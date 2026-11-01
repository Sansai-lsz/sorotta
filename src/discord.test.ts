import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { editChannelMessage, editOriginal, followUp, getOriginalMessageId } from "./discord.ts";

const TOKEN = "secret-interaction-token";

let errors: unknown[][];

beforeEach(() => {
  errors = [];
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    errors.push(args);
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn(async () => {
    const next = responses.shift();
    if (next === undefined) throw new Error("unexpected fetch");
    if (next instanceof Error) throw next;
    return next;
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("Discord API の呼び出し", () => {
  it("成功すれば true を返す", async () => {
    stubFetch(new Response("{}", { status: 200 }));
    expect(await editOriginal("app", TOKEN, { content: "x" })).toBe(true);
  });

  it("失敗すれば false を返し、ログに interaction token を残さない", async () => {
    stubFetch(new Response("Unknown Webhook", { status: 404 }));
    expect(await followUp("app", TOKEN, { content: "x" })).toBe(false);
    expect(errors).toHaveLength(1);
    expect(String(errors[0]?.[0])).toContain("/webhooks/app/***");
    expect(JSON.stringify(errors)).not.toContain(TOKEN);
  });

  it("通信に失敗しても例外を投げずに false を返す", async () => {
    stubFetch(new Error("network down"));
    expect(await editChannelMessage("bot", "c", "m", { content: "x" })).toBe(false);
  });
});

describe("getOriginalMessageId", () => {
  it("すぐに試し、404 の間は 1 秒ずつ待って試し直す", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(
      new Response("", { status: 404 }),
      new Response(JSON.stringify({ id: "999" }), { status: 200 }),
    );
    const pending = getOriginalMessageId("app", TOKEN);
    await vi.advanceTimersByTimeAsync(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await pending).toBe("999");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("3 回とも 404 なら null を返し、ログに interaction token を残さない", async () => {
    vi.useFakeTimers();
    const fetchMock = stubFetch(...[1, 2, 3].map(() => new Response("", { status: 404 })));
    const pending = getOriginalMessageId("app", TOKEN);
    await vi.advanceTimersByTimeAsync(2000);
    expect(await pending).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(JSON.stringify(errors)).not.toContain(TOKEN);
  });
});
