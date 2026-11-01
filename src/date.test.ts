import { describe, expect, it } from "vitest";
import { addDays, clockOf, formatDate, formatMonthDay, gameToday, parseDateInput } from "./date.ts";

const jst = (local: string) => new Date(`${local}+09:00`);

describe("gameToday", () => {
  it("JST の 6 時以降はその日になる", () => {
    expect(gameToday(jst("2026-11-01T06:00:00"))).toBe("2026-11-01");
    expect(gameToday(jst("2026-11-01T23:59:00"))).toBe("2026-11-01");
  });

  it("JST の 0〜5 時は前日になる", () => {
    expect(gameToday(jst("2026-11-01T00:30:00"))).toBe("2026-10-31");
    expect(gameToday(jst("2026-11-01T05:59:00"))).toBe("2026-10-31");
  });
});

describe("clockOf", () => {
  it("募集日の JST 0 時からの経過時間を返す", () => {
    expect(clockOf("2026-11-01", jst("2026-11-01T16:30:00"))).toBe(16.5);
  });

  it("翌日の 1 時は 25", () => {
    expect(clockOf("2026-11-01", jst("2026-11-02T01:00:00"))).toBe(25);
  });

  it("募集日より前なら負になる", () => {
    expect(clockOf("2026-11-02", jst("2026-11-01T21:00:00"))).toBe(-3);
  });
});

describe("parseDateInput", () => {
  const lateNight = jst("2026-11-01T00:30:00");

  it("省略や「今日」はゲーム日の今日になる", () => {
    expect(parseDateInput(undefined, lateNight)).toBe("2026-10-31");
    expect(parseDateInput("今日", lateNight)).toBe("2026-10-31");
  });

  it("「明日」はゲーム日の翌日になる", () => {
    expect(parseDateInput("明日", lateNight)).toBe("2026-11-01");
  });

  it("月/日 はゲーム日の今日以降の直近の日付になる", () => {
    expect(parseDateInput("10/31", lateNight)).toBe("2026-10-31");
    expect(parseDateInput("11/3", lateNight)).toBe("2026-11-03");
    expect(parseDateInput("1/5", lateNight)).toBe("2027-01-05");
  });

  it("全角の数字とスラッシュも受け付ける", () => {
    expect(parseDateInput("１１／３", lateNight)).toBe("2026-11-03");
  });

  it("存在しない日付や読めない文字列は null", () => {
    expect(parseDateInput("2/30", lateNight)).toBeNull();
    expect(parseDateInput("来週", lateNight)).toBeNull();
  });
});

describe("addDays", () => {
  it("月をまたいで日付を進める", () => {
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });
});

describe("formatDate", () => {
  it("月/日(曜日) の形にする", () => {
    expect(formatDate("2026-11-01")).toBe("11/1(日)");
  });
});

describe("formatMonthDay", () => {
  it("月/日 の形にする", () => {
    expect(formatMonthDay("2026-11-02")).toBe("11/2");
  });
});
