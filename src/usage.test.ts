import { MessageFlags } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { commands, GAME_COMMAND, RECRUIT_COMMAND, USAGE_COMMAND } from "./commands.ts";
import { USAGE_TEXT, usageResponse } from "./usage.ts";

// Discord の 1 メッセージの上限
const MESSAGE_LIMIT = 2000;

describe("USAGE_TEXT", () => {
  it("1 通のメッセージに収まる", () => {
    expect(USAGE_TEXT.length).toBeLessThanOrEqual(MESSAGE_LIMIT);
  });

  it("登録しているコマンドの名前で案内する", () => {
    expect(USAGE_TEXT).toContain(`/${RECRUIT_COMMAND}`);
    expect(USAGE_TEXT).toContain(`/${GAME_COMMAND} add`);
    expect(USAGE_TEXT).toContain(`/${USAGE_COMMAND}`);
  });
});

describe("usageResponse", () => {
  it("使い方を実行した人にだけ表示する", async () => {
    const body: unknown = await usageResponse().json();
    expect(body).toMatchObject({ data: { content: USAGE_TEXT, flags: MessageFlags.Ephemeral } });
  });
});

describe("commands", () => {
  it("使い方のコマンドを登録する", () => {
    expect(commands.map((c) => c.name)).toContain(USAGE_COMMAND);
  });
});
