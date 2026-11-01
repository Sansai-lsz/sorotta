import { describe, expect, it } from "vitest";
import { tally } from "./tally.ts";

describe("tally", () => {
  it("開始時刻ごとに参加者を分け、パスした人を別に数える", () => {
    const t = tally(
      [
        { userId: "a", hour: 21 },
        { userId: "b", hour: 20 },
        { userId: "c", hour: 21 },
        { userId: "d", hour: null },
      ],
      5,
    );
    expect(t.byHour.get(20)).toEqual(["b"]);
    expect(t.byHour.get(21)).toEqual(["a", "c"]);
    expect(t.passed).toEqual(["d"]);
    expect(t.participantCount).toBe(3);
    expect(t.ready).toBeNull();
  });

  it("早い時刻から来られる人も後の時刻の人数に含め、最初にそろう時刻を返す", () => {
    const t = tally(
      [
        { userId: "a", hour: 20 },
        { userId: "b", hour: 22 },
        { userId: "c", hour: 21 },
        { userId: "d", hour: 24 },
      ],
      3,
    );
    expect(t.ready).toEqual({ hour: 22, userIds: ["a", "c", "b"] });
  });

  it("必要人数ちょうどでそろったとみなす", () => {
    const t = tally([{ userId: "a", hour: 23 }], 1);
    expect(t.ready).toEqual({ hour: 23, userIds: ["a"] });
  });

  it("ボタンにない時刻は無視する", () => {
    const t = tally([{ userId: "a", hour: 19 }], 1);
    expect(t.participantCount).toBe(0);
    expect(t.ready).toBeNull();
  });
});
