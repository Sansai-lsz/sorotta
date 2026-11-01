import { describe, expect, it } from "vitest";
import { hoursSinceDateStart } from "./date.ts";
import {
  bucketOf,
  bucketsOf,
  hourLabel,
  isHourOver,
  isScope,
  isScopeOver,
  nowHourIn,
  openHours,
  planRecruitment,
  shortHourLabel,
} from "./buckets.ts";

const jst = (local: string) => new Date(`${local}+09:00`);

describe("planRecruitment", () => {
  const today = "2026-11-01";
  const plan = (local: string) => planRecruitment({ date: today, scope: undefined }, jst(local));

  it.each([
    ["2026-11-01T09:00:00", "morning"],
    ["2026-11-01T15:00:00", "noon"],
    ["2026-11-01T16:30:00", "night"],
    ["2026-11-01T21:30:00", "night"],
    ["2026-11-02T01:00:00", "late"],
  ] as const)("時間帯を省略すると今日の %s は %s になる", (local, scope) => {
    expect(plan(local)).toEqual({ ok: true, date: today, scope });
  });

  it("深夜の残りが 3 時刻未満なら翌日の朝になる", () => {
    expect(plan("2026-11-02T04:00:00")).toEqual({ ok: true, date: "2026-11-02", scope: "morning" });
  });

  it("時間帯を省略して今日以外の日付なら夜になる", () => {
    expect(planRecruitment({ date: "2026-11-03", scope: undefined }, jst("2026-11-01T09:00:00"))).toEqual({
      ok: true,
      date: "2026-11-03",
      scope: "night",
    });
  });

  it("指定した時間帯の時刻がすべて過ぎていればエラー", () => {
    expect(planRecruitment({ date: today, scope: "morning" }, jst("2026-11-01T12:00:00"))).toEqual({
      ok: false,
      error: "over",
    });
  });

  it("指定した時間帯に 1 つでも時刻が残っていれば募集できる", () => {
    expect(planRecruitment({ date: today, scope: "morning" }, jst("2026-11-01T11:30:00"))).toEqual({
      ok: true,
      date: today,
      scope: "morning",
    });
  });

  it("いつでもは 1 つでも時刻が残っていれば募集できる", () => {
    expect(planRecruitment({ date: today, scope: "any" }, jst("2026-11-02T05:30:00"))).toEqual({
      ok: true,
      date: today,
      scope: "any",
    });
    expect(planRecruitment({ date: today, scope: "any" }, jst("2026-11-02T06:00:00"))).toEqual({
      ok: false,
      error: "over",
    });
  });
});

describe("isHourOver", () => {
  it("その時刻の 1 時間が終わったら過ぎたとみなす", () => {
    expect(isHourOver(21, 21.5)).toBe(false);
    expect(isHourOver(21, 22)).toBe(true);
  });

  it("深夜は 24〜29 で翌日の時刻を表す", () => {
    expect(isHourOver(24, 24.9)).toBe(false);
    expect(isHourOver(24, 25)).toBe(true);
    expect(isHourOver(29, 29.9)).toBe(false);
    expect(isHourOver(29, 30)).toBe(true);
  });
});

describe("openHours", () => {
  it("過ぎていない時刻だけを返す", () => {
    expect(openHours(bucketOf("night"), 21.5)).toEqual([21, 22, 23]);
  });
});

describe("nowHourIn", () => {
  it("今がその時間帯の中なら今の時刻を返す", () => {
    expect(nowHourIn(bucketOf("night"), 21.5)).toBe(21);
    expect(nowHourIn(bucketOf("late"), 25)).toBe(25);
  });

  it("今がその時間帯の外なら null", () => {
    expect(nowHourIn(bucketOf("night"), 16.5)).toBeNull();
  });
});

describe("isScopeOver", () => {
  it("時間帯の時刻がすべて過ぎたら終わり", () => {
    expect(isScopeOver("night", 23.5)).toBe(false);
    expect(isScopeOver("night", 24)).toBe(true);
  });

  it("いつでもは深夜の最後の時刻が過ぎたら終わり", () => {
    expect(isScopeOver("any", 29.5)).toBe(false);
    expect(isScopeOver("any", 30)).toBe(true);
  });

  it("深夜の募集は翌日の 6 時に終わる", () => {
    expect(isScopeOver("late", hoursSinceDateStart("2026-11-01", jst("2026-11-02T05:59:00")))).toBe(false);
    expect(isScopeOver("late", hoursSinceDateStart("2026-11-01", jst("2026-11-02T06:00:00")))).toBe(true);
  });
});

describe("bucketsOf", () => {
  it("いつでもは 4 つの時間帯を時系列順に返す", () => {
    expect(bucketsOf("any").map((b) => b.key)).toEqual(["morning", "noon", "night", "late"]);
  });

  it("時間帯を指定すればその 1 つだけ", () => {
    expect(bucketsOf("late").map((b) => b.key)).toEqual(["late"]);
  });
});

describe("isScope", () => {
  it("時間帯のキーと any だけを受け付ける", () => {
    expect(isScope("night")).toBe(true);
    expect(isScope("any")).toBe(true);
    expect(isScope("evening")).toBe(false);
  });
});

describe("hourLabel", () => {
  it("24 時未満は時刻だけ", () => {
    expect(hourLabel(21, "2026-11-01")).toBe("21時〜");
  });

  it("深夜は翌日の日付を付ける", () => {
    expect(hourLabel(24, "2026-11-01")).toBe("0時〜（11/2）");
    expect(hourLabel(29, "2026-10-31")).toBe("5時〜（11/1）");
  });

  it("短い表記は深夜でも日付を付けない", () => {
    expect(shortHourLabel(24)).toBe("0時〜");
    expect(shortHourLabel(21)).toBe("21時〜");
  });
});
