import { ComponentType, MessageFlags } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type { Recruitment } from "../domain/recruitment.ts";
import type { Participant } from "../domain/tally.ts";
import { boardEditPayload, boardInitialPayload, gameLabel, renderBoard } from "./board.ts";
import { at, anyRec, base, jst, lateRec, night } from "./testData.ts";

function descriptionOf(rec: Recruitment, participants: Participant[], now: Date): string {
  return textDisplaysOf(rec, participants, now)[1] ?? "";
}

function containerOf(rec: Recruitment, participants: Participant[], now: Date) {
  const container = renderBoard(rec, participants, now).components?.find((c) => c.type === ComponentType.Container);
  if (container?.type !== ComponentType.Container) throw new Error("container missing");
  return container;
}

function textDisplaysOf(rec: Recruitment, participants: Participant[], now: Date): string[] {
  return containerOf(rec, participants, now).components.flatMap((c) =>
    c.type === ComponentType.TextDisplay ? [c.content] : [],
  );
}

function titleOf(rec: Recruitment, participants: Participant[], now: Date): string {
  return textDisplaysOf(rec, participants, now)[0] ?? "";
}

function rowsOf(rec: Recruitment, participants: Participant[], now: Date) {
  const components = containerOf(rec, participants, now).components;
  return components.flatMap((row) => (row.type === ComponentType.ActionRow ? [row.components] : []));
}

function labelsOf(rec: Recruitment, participants: Participant[], now: Date): string[][] {
  return rowsOf(rec, participants, now).map((row) =>
    row.map((c) =>
      c.type === ComponentType.Button && "label" in c
        ? (c.label ?? "")
        : c.type === ComponentType.StringSelect
          ? (c.placeholder ?? "")
          : "",
    ),
  );
}

describe("renderBoard（時間帯を 1 つ指定した募集）", () => {
  const evening = jst("2026-11-01T17:00:00");

  it("タイトルに日付と時間帯を出す", () => {
    expect(titleOf(base, [], evening)).toBe("### 🎮 Apex やる人？ 11/1(日) 🌙夜");
  });

  it("時刻ごとにその時刻から来る人を並べ、だれもいなければ － にする", () => {
    const description = descriptionOf(base, [at("a", night(21)), at("b", night(21)), at("c", night(22))], evening);
    expect(description).toContain("募集: <@host>（3人〜・定員3人）");
    expect(description).toContain("**18時〜**　－");
    expect(description).toContain("**21時〜**　<@a> <@b>");
    expect(description).toContain("**22時〜**　<@c>");
  });

  it("今すぐの人と補欠の人に印を付ける", () => {
    const description = descriptionOf(
      base,
      [at("a", night(21, true)), at("b", night(21)), at("c", night(21)), at("d", night(21))],
      jst("2026-11-01T21:10:00"),
    );
    expect(description).toContain("**21時〜**　<@a> ⚡今すぐ <@b> <@c> <@d> 補欠");
    expect(description).toContain("補欠: <@d>");
  });

  it("深夜の時刻には翌日の日付を付ける", () => {
    const description = descriptionOf(lateRec, [at("a", { late: { hour: 24, now: false } })], evening);
    expect(description).toContain("**0時〜（11/2）**　<@a>");
    expect(description).toContain("**5時〜（11/2）**　－");
  });

  it("過ぎた時刻には打ち消し線を引く", () => {
    const description = descriptionOf(base, [at("a", night(18))], jst("2026-11-01T20:30:00"));
    expect(description).toContain("~~18時〜~~　<@a>");
    expect(description).toContain("~~19時〜~~　－");
    expect(description).toContain("**20時〜**　－");
  });

  it("過ぎていない時刻だけをボタンにして 5 個で折り返し、最後の行にパスと ⚙ を置く", () => {
    expect(labelsOf(base, [], evening)).toEqual([
      ["18時〜", "19時〜", "20時〜", "21時〜", "22時〜"],
      ["23時〜"],
      ["今日はパス", "⚙"],
    ]);
    expect(labelsOf(base, [], jst("2026-11-01T21:30:00"))).toEqual([
      ["⚡ 今すぐ", "21時〜", "22時〜", "23時〜"],
      ["今日はパス", "⚙"],
    ]);
  });

  it("深夜のボタンは日付を付けない", () => {
    expect(labelsOf(lateRec, [], jst("2026-11-02T03:30:00"))).toEqual([
      ["⚡ 今すぐ", "3時〜", "4時〜", "5時〜"],
      ["今日はパス", "⚙"],
    ]);
  });

  it("そろえば時間帯名なしで最初にそろう時刻を出す", () => {
    const participants = [at("a", night(20)), at("b", night(21)), at("c", night(22))];
    expect(descriptionOf(base, participants, evening)).toContain("✅ **22時〜なら 3人そろう**");
    expect(containerOf(base, participants, evening).accent_color).toBe(0x57f287);
  });

  it("そろっていなければ残り人数を出し、パスした人も並べる", () => {
    const description = descriptionOf(base, [at("a", night(21)), { userId: "d", passed: true }], evening);
    expect(description).toContain("あと 2人");
    expect(description).toContain("パス: <@d>");
  });

  it("定員がなければ最少人数だけを出す", () => {
    expect(descriptionOf({ ...base, max: null }, [], evening)).toContain("募集: <@host>（3人〜）");
  });
});

describe("renderBoard（いつでも）", () => {
  const morning = jst("2026-11-01T09:30:00");

  it("時間帯ごとに開始時刻順で人と時刻を並べ、いつでもOK の人を別の行にする", () => {
    const participants: Participant[] = [
      at("a", { night: { hour: 22, now: false }, late: { hour: 25, now: false } }),
      at("b", { night: { hour: 21, now: false } }),
      { userId: "x", passed: false, anytime: true, slots: {} },
    ];
    const description = descriptionOf(anyRec, participants, morning);
    expect(titleOf(anyRec, participants, morning)).toBe("### 🎮 Apex やる人？ 11/1(日) いつでも");
    expect(description).toContain("**🌅 朝**　－");
    expect(description).toContain("**🌙 夜**　<@b> 21時〜　<@a> 22時〜");
    expect(description).toContain("**🌌 深夜**　<@a> 1時〜（11/2）");
    expect(description).toContain("**🙆 いつでも**　<@x>");
  });

  it("全時刻が過ぎた時間帯のラベルに打ち消し線を引く", () => {
    expect(descriptionOf(anyRec, [], jst("2026-11-01T12:30:00"))).toContain("~~🌅 朝~~　－");
  });

  it("時間帯ごとのセレクト 4 行とボタン 1 行を出す", () => {
    expect(labelsOf(anyRec, [], morning)).toEqual([
      ["🌅 朝なら何時から？"],
      ["☀️ 昼なら何時から？"],
      ["🌙 夜なら何時から？"],
      ["🌌 深夜なら何時から？"],
      ["🙆 いつでもOK", "今日はパス", "⚙"],
    ]);
  });

  it("セレクトには今すぐ、過ぎていない時刻、無理の順に選択肢を並べる", () => {
    const [morningRow, , , lateRow] = rowsOf(anyRec, [], morning);
    const options = (row: typeof morningRow) => {
      const select = row?.[0];
      return select?.type === ComponentType.StringSelect ? select.options.map((o) => [o.label, o.value]) : [];
    };
    expect(options(morningRow)).toEqual([
      ["⚡ 今すぐ", "now"],
      ["9時〜", "9"],
      ["10時〜", "10"],
      ["11時〜", "11"],
      ["朝は無理", "none"],
    ]);
    expect(options(lateRow)[0]).toEqual(["0時〜（11/2）", "24"]);
  });

  it("全時刻が過ぎた時間帯のセレクトは終了と出して押せなくする", () => {
    const [morningRow] = rowsOf(anyRec, [], jst("2026-11-01T12:30:00"));
    const select = morningRow?.[0];
    expect(select?.type === ComponentType.StringSelect && select.placeholder).toBe("🌅 朝なら何時から？（終了）");
    expect(select?.type === ComponentType.StringSelect && select.disabled).toBe(true);
  });

  it("そろえば時間帯名付きで最初にそろう時刻を出す", () => {
    const participants = [1, 2, 3].map((n) => at(`u${n}`, { night: { hour: 21, now: false } }));
    expect(descriptionOf(anyRec, participants, morning)).toContain("✅ **夜 21時〜なら 3人そろう**");
  });

  it("いつでもOK の人にも補欠の印を付ける", () => {
    const participants: Participant[] = [
      ...[1, 2, 3].map((n) => at(`u${n}`, { night: { hour: 21, now: false } })),
      { userId: "x", passed: false, anytime: true, slots: {} },
    ];
    expect(descriptionOf(anyRec, participants, morning)).toContain("**🙆 いつでも**　<@x> 補欠");
  });
});

describe("renderBoard（終わった募集）", () => {
  const participants = [at("a", night(18)), at("b", night(19)), at("c", night(20))];
  const after = jst("2026-11-02T07:00:00");

  it("締め切ったらバッジを付け、ボタンを消し、通知した時刻の結果を残す", () => {
    const closed = { ...base, status: "closed" as const, notifiedSlot: { bucket: "night" as const, hour: 20 } };
    const description = descriptionOf(closed, participants, after);
    expect(titleOf(closed, participants, after)).toBe("### 🎮 Apex やる人？ 11/1(日) 🌙夜 ［締め切り］");
    expect(description).toContain("✅ **20時〜なら 3人そろう**");
    expect(description).toContain("**18時〜**　<@a>");
    expect(description).toMatch(/この募集は締め切られました$/);
    expect(containerOf(closed, participants, after).accent_color).toBe(0x99aab5);
    expect(containerOf(closed, participants, after).components).toHaveLength(2);
  });

  it("そろう前に終わったらそろわなかったと出す", () => {
    const description = descriptionOf({ ...base, status: "closed" }, participants.slice(0, 2), after);
    expect(description).toContain("そろいませんでした");
    expect(description).not.toContain("あと");
  });

  it("いつでもOK の人がいても、過ぎた朝の時刻ではなく通知した時刻を結果にする", () => {
    const description = descriptionOf(
      { ...anyRec, status: "closed", notifiedSlot: { bucket: "night", hour: 20 } },
      [{ userId: "x", passed: false, anytime: true, slots: {} }, ...participants.slice(0, 2), at("c", night(20))],
      after,
    );
    expect(description).toContain("✅ **夜 20時〜なら 3人そろう**");
    expect(description).toContain("補欠: <@c>");
  });

  it("中止したらバッジと中止の文言を出す", () => {
    const cancelled = { ...base, status: "cancelled" as const };
    const description = descriptionOf(cancelled, participants, after);
    expect(titleOf(cancelled, participants, after)).toBe("### 🎮 Apex やる人？ 11/1(日) 🌙夜 ［中止］");
    expect(description).toContain("そろいませんでした");
    expect(description).toMatch(/この募集は中止されました$/);
    expect(containerOf(cancelled, participants, after).components).toHaveLength(2);
  });
});

describe("renderBoard のメンション", () => {
  const evening = jst("2026-11-01T17:00:00");

  it("一覧のメンションでは誰にも通知しない", () => {
    expect(renderBoard(base, [], evening).allowed_mentions).toEqual({ parse: [] });
  });

  it("ロールがあれば盤面の前にメンション行を置き、なければ置かない", () => {
    const withRole = renderBoard({ ...base, notifyRoleId: "r1" }, [], evening);
    expect(withRole.components?.[0]).toEqual({
      type: ComponentType.TextDisplay,
      content: "<@&r1> Apex の募集が出ました",
    });
    expect(renderBoard(base, [], evening).components?.[0]?.type).toBe(ComponentType.Container);
  });

  it("初回投稿だけ保存したロールへの通知を許可する", () => {
    expect(boardInitialPayload({ ...base, notifyRoleId: "r1" }, [], evening).allowed_mentions).toEqual({
      parse: [],
      roles: ["r1"],
    });
    expect(boardInitialPayload(base, [], evening).allowed_mentions).toEqual({ parse: [] });
    expect(boardEditPayload({ ...base, notifyRoleId: "r1" }, [], evening).allowed_mentions).toEqual({ parse: [] });
  });

  it("V2 フラグを付け、本文と embed を持たない", () => {
    const board = renderBoard(base, [], evening);
    expect(board.flags).toBe(MessageFlags.IsComponentsV2);
    expect(board.embeds).toBeUndefined();
    expect(board.content).toBeUndefined();
  });

  it("旧盤面を書き換える payload は本文と embed を消す", () => {
    expect(boardEditPayload(base, [], evening)).toMatchObject({
      content: null,
      embeds: [],
      flags: MessageFlags.IsComponentsV2,
    });
  });

  it("受付中と終了の色を出す", () => {
    expect(containerOf(base, [], evening).accent_color).toBe(0x5865f2);
    expect(containerOf({ ...base, status: "closed" }, [], evening).accent_color).toBe(0x99aab5);
  });

  it.each([
    { rec: base, now: jst("2026-11-01T18:10:00") },
    { rec: anyRec, now: jst("2026-11-01T17:00:00") },
  ])("参加者が多くても部品数が 40 以下: $rec.scope", ({ rec, now }) => {
    const participants = Array.from({ length: 50 }, (_, i) => at(`u${i}`, night(21)));
    const board = renderBoard({ ...rec, max: null, notifyRoleId: "r1" }, participants, now);
    const count = (components: NonNullable<typeof board.components>): number =>
      components.reduce((n, c) => n + 1 + ("components" in c ? count(c.components as typeof components) : 0), 0);
    const total = count(board.components ?? []);
    expect(total).toBe(16);
    expect(total).toBeLessThanOrEqual(40);
  });
});

describe("gameLabel", () => {
  it("定員があれば並べて出す", () => {
    expect(gameLabel({ name: "Apex", min: 3, max: 3 })).toBe("Apex（3人〜・定員3人）");
    expect(gameLabel({ name: "マイクラ", min: 2, max: null })).toBe("マイクラ（2人〜）");
  });
});
