import { describe, expect, it } from "vitest";
import { joinCustomId, parseCustomId, passCustomId, renderBoard, renderReadyNotice } from "./render.ts";

const rec = { id: "123", game: "Apex", required: 3, date: "2026-11-01", recruiterId: "host" };

describe("custom_id", () => {
  it("参加ボタンとパスボタンの custom_id を往復できる", () => {
    expect(parseCustomId(joinCustomId("123", 22))).toEqual({ kind: "join", recruitmentId: "123", hour: 22 });
    expect(parseCustomId(passCustomId("123"))).toEqual({ kind: "pass", recruitmentId: "123" });
  });

  it("形式の違う custom_id は null", () => {
    expect(parseCustomId("x:123")).toBeNull();
    expect(parseCustomId("j:123:abc")).toBeNull();
    expect(parseCustomId("j")).toBeNull();
  });
});

describe("renderBoard", () => {
  it("そろっていなければ残り人数を出す", () => {
    const board = renderBoard(rec, [{ userId: "a", hour: 21 }]);
    const embed = board.embeds?.[0];
    expect(embed?.title).toBe("🎮 Apex やる人？ 11/1(日)");
    expect(embed?.description).toContain("**21時〜**　<@a>");
    expect(embed?.description).toContain("あと 2人");
  });

  it("そろえば最初にそろう時刻を出し、パスした人も並べる", () => {
    const board = renderBoard(rec, [
      { userId: "a", hour: 20 },
      { userId: "b", hour: 21 },
      { userId: "c", hour: 22 },
      { userId: "d", hour: null },
    ]);
    const description = board.embeds?.[0]?.description;
    expect(description).toContain("✅ **22時〜なら 3人そろう**");
    expect(description).toContain("パス: <@d>");
  });

  it("一覧のメンションでは誰にも通知しない", () => {
    expect(renderBoard(rec, []).allowed_mentions).toEqual({ parse: [] });
  });
});

describe("renderReadyNotice", () => {
  it("そろったメンバーだけにメンションする", () => {
    const notice = renderReadyNotice("Apex", 22, ["a", "b", "c"]);
    expect(notice.content).toBe("🎮 Apex 22時〜で3人そろいました！ <@a> <@b> <@c>");
    expect(notice.allowed_mentions).toEqual({ users: ["a", "b", "c"] });
  });
});
