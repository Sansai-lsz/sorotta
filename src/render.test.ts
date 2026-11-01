import { ComponentType } from "discord-api-types/v10";
import { describe, expect, it } from "vitest";
import type { Recruitment } from "./recruitment.ts";
import {
  gameLabel,
  renderBoard,
  renderCancelNotice,
  renderManagePanel,
  renderReadyNotice,
} from "./render.ts";
import type { Participant } from "./tally.ts";

const jst = (local: string) => new Date(`${local}+09:00`);

const base: Recruitment = {
  id: "123",
  guildId: "g",
  channelId: "c",
  messageId: null,
  game: "Apex",
  min: 3,
  max: 3,
  date: "2026-11-01",
  scope: "night",
  hostId: "host",
  status: "open",
};
const anyRec: Recruitment = { ...base, scope: "any" };
const lateRec: Recruitment = { ...base, scope: "late" };

const at = (userId: string, slots: Participant["slots"]): Participant => ({ userId, passed: false, anytime: false, slots });
const night = (hour: number, now = false) => ({ night: { hour, now } });

function descriptionOf(rec: Recruitment, participants: Participant[], now: Date): string {
  return renderBoard(rec, participants, now).embeds?.[0]?.description ?? "";
}

function rowsOf(rec: Recruitment, participants: Participant[], now: Date) {
  const components = renderBoard(rec, participants, now).components ?? [];
  return components.flatMap((row) => (row.type === ComponentType.ActionRow ? [row.components] : []));
}

function labelsOf(rec: Recruitment, participants: Participant[], now: Date): string[][] {
  return rowsOf(rec, participants, now).map((row) =>
    row.map((c) => (c.type === ComponentType.Button && "label" in c ? (c.label ?? "") : c.type === ComponentType.StringSelect ? (c.placeholder ?? "") : "")),
  );
}

describe("renderBoard（時間帯を 1 つ指定した募集）", () => {
  const evening = jst("2026-11-01T17:00:00");

  it("タイトルに日付と時間帯を出す", () => {
    expect(renderBoard(base, [], evening).embeds?.[0]?.title).toBe("🎮 Apex やる人？ 11/1(日) 🌙夜");
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
    const description = descriptionOf(base, [at("a", night(20)), at("b", night(21)), at("c", night(22))], evening);
    expect(description).toContain("✅ **22時〜なら 3人そろう**");
    expect(renderBoard(base, [at("a", night(20)), at("b", night(21)), at("c", night(22))], evening).embeds?.[0]?.color).toBe(
      0x57f287,
    );
  });

  it("そろっていなければ残り人数を出し、パスした人も並べる", () => {
    const description = descriptionOf(
      base,
      [at("a", night(21)), { userId: "d", passed: true, anytime: false, slots: {} }],
      evening,
    );
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
    expect(renderBoard(anyRec, participants, morning).embeds?.[0]?.title).toBe("🎮 Apex やる人？ 11/1(日) いつでも");
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

  it("締め切ったらバッジを付け、ボタンを消し、過ぎた時刻も数えて結果を残す", () => {
    const board = renderBoard({ ...base, status: "closed" }, participants, after);
    expect(board.embeds?.[0]?.title).toBe("🎮 Apex やる人？ 11/1(日) 🌙夜 ［締め切り］");
    expect(board.embeds?.[0]?.description).toContain("✅ **20時〜なら 3人そろう**");
    expect(board.embeds?.[0]?.description).toContain("**18時〜**　<@a>");
    expect(board.embeds?.[0]?.description).toMatch(/この募集は締め切られました$/);
    expect(board.embeds?.[0]?.color).toBe(0x99aab5);
    expect(board.components).toEqual([]);
  });

  it("中止したらバッジと中止の文言を出す", () => {
    const board = renderBoard({ ...base, status: "cancelled" }, participants, after);
    expect(board.embeds?.[0]?.title).toBe("🎮 Apex やる人？ 11/1(日) 🌙夜 ［中止］");
    expect(board.embeds?.[0]?.description).toMatch(/この募集は中止されました$/);
    expect(board.components).toEqual([]);
  });
});

describe("renderBoard のメンション", () => {
  it("一覧のメンションでは誰にも通知しない", () => {
    expect(renderBoard(base, [], jst("2026-11-01T17:00:00")).allowed_mentions).toEqual({ parse: [] });
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

describe("gameLabel", () => {
  it("定員があれば並べて出す", () => {
    expect(gameLabel({ name: "Apex", min: 3, max: 3 })).toBe("Apex（3人〜・定員3人）");
    expect(gameLabel({ name: "マイクラ", min: 2, max: null })).toBe("マイクラ（2人〜）");
  });
});
