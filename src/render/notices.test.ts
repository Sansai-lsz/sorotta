import { ComponentType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import { renderBoard } from "./board.ts";
import {
  endedNotice,
  renderCancelNotice,
  renderFinishResult,
  renderManagePanel,
  renderReadyNotice,
  withRoleMention,
} from "./notices.ts";
import { anyRec, base, jst } from "./testData.ts";

describe("withRoleMention", () => {
  const board = renderBoard(base, [], jst("2026-11-01T17:00:00"));

  it("本文でロールにメンションし、そのロールにだけ通知を許す", () => {
    const withRole = withRoleMention(board, "Apex", "r1");
    expect(withRole.content).toBe("<@&r1> Apex の募集が出ました");
    expect(withRole.allowed_mentions).toEqual({ parse: [], roles: ["r1"] });
    expect(withRole.embeds).toEqual(board.embeds);
    expect(withRole.components).toEqual(board.components);
  });

  it("ロールがなければ投稿を変えない", () => {
    expect(withRoleMention(board, "Apex", null)).toBe(board);
  });
});

describe("renderReadyNotice", () => {
  it("そろったメンバーだけにメンションする", () => {
    const notice = renderReadyNotice(base, { bucket: "night", hour: 22, members: ["a", "b", "c"], reserves: ["d"] });
    expect(notice.content).toBe("🎮 Apex 22時〜で3人そろいました！ <@a> <@b> <@c>");
    expect(notice.allowed_mentions).toEqual({ users: ["a", "b", "c"] });
  });

  it("いつでもの募集では時間帯名を付ける", () => {
    const notice = renderReadyNotice(anyRec, { bucket: "late", hour: 24, members: ["a"], reserves: [] });
    expect(notice.content).toBe("🎮 Apex 深夜 0時〜で1人そろいました！ <@a>");
  });
});

describe("renderCancelNotice", () => {
  it("参加予定だった人にメンションする", () => {
    const notice = renderCancelNotice(base, ["a", "x"]);
    expect(notice.content).toBe("Apex の募集は中止になりました <@a> <@x>");
    expect(notice.allowed_mentions).toEqual({ users: ["a", "x"] });
  });
});

describe("renderManagePanel", () => {
  it("締め切ると中止のボタンを出す", () => {
    const panel = renderManagePanel(base);
    expect(panel.content).toBe("この募集を管理");
    expect(panel.components).toEqual([
      {
        type: ComponentType.ActionRow,
        components: [
          expect.objectContaining({ label: "締め切る", custom_id: "c:123" }),
          expect.objectContaining({ label: "中止", custom_id: "x:123" }),
        ],
      },
    ]);
  });
});

describe("renderFinishResult", () => {
  it("投稿の書き換えと通知に成功すればそのまま知らせる", () => {
    expect(renderFinishResult("closed", { board: true, notice: true })).toBe("締め切りました");
    expect(renderFinishResult("cancelled", { board: true, notice: true })).toBe("中止しました");
  });

  it("投稿を書き換えられなければ、状態は変わったことと権限の確認を知らせる", () => {
    expect(renderFinishResult("closed", { board: false, notice: true })).toBe(
      "締め切りました。ただし募集の投稿を書き換えられませんでした（bot の権限を確認してください）",
    );
  });

  it("中止の通知を送れなければそれを知らせる", () => {
    expect(renderFinishResult("cancelled", { board: true, notice: false })).toBe(
      "中止しました。ただし中止の通知を送れませんでした（bot の権限を確認してください）",
    );
    expect(renderFinishResult("cancelled", { board: false, notice: false })).toBe(
      "中止しました。ただし募集の投稿を書き換えられず、中止の通知も送れませんでした（bot の権限を確認してください）",
    );
  });
});

describe("endedNotice", () => {
  it("締め切りと中止で断りの文言を変える", () => {
    expect(endedNotice("closed")).toBe("この募集は締め切られています");
    expect(endedNotice("cancelled")).toBe("この募集は中止されています");
  });
});
