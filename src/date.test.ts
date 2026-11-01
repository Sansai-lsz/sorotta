import { describe, expect, it } from "vitest";
import { formatDate, parseDateInput } from "./date.ts";

// 2026-11-01 00:30 JST（UTC ではまだ 10/31）
const now = new Date("2026-10-31T15:30:00Z");

describe("parseDateInput", () => {
  it("省略や「今日」は JST の今日になる", () => {
    expect(parseDateInput(undefined, now)).toBe("2026-11-01");
    expect(parseDateInput("今日", now)).toBe("2026-11-01");
  });

  it("「明日」は JST の翌日になる", () => {
    expect(parseDateInput("明日", now)).toBe("2026-11-02");
  });

  it("月/日 は今日以降の直近の日付になる", () => {
    expect(parseDateInput("11/3", now)).toBe("2026-11-03");
    expect(parseDateInput("1/5", now)).toBe("2027-01-05");
  });

  it("全角の数字とスラッシュも受け付ける", () => {
    expect(parseDateInput("１１／３", now)).toBe("2026-11-03");
  });

  it("存在しない日付や読めない文字列は null", () => {
    expect(parseDateInput("2/30", now)).toBeNull();
    expect(parseDateInput("来週", now)).toBeNull();
  });
});

describe("formatDate", () => {
  it("月/日(曜日) の形にする", () => {
    expect(formatDate("2026-11-01")).toBe("11/1(日)");
  });
});
