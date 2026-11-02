import { describe, expect, it } from "vitest";
import {
  encodeCustomId,
  encodeSelectValue,
  parseCustomId,
  parseSelectValue,
  type ComponentAction,
} from "./customId.ts";
import type { SelectValue } from "../domain/answer.ts";
import { BUCKETS } from "../domain/buckets.ts";

describe("custom_id", () => {
  const id = "1234567890123456789";
  const actions: ComponentAction[] = [
    { kind: "hour", recruitmentId: id, hour: 24 },
    { kind: "now", recruitmentId: id, bucket: "night" },
    { kind: "select", recruitmentId: id, bucket: "late" },
    { kind: "anytime", recruitmentId: id },
    { kind: "pass", recruitmentId: id },
    { kind: "gear", recruitmentId: id },
    { kind: "manageAnswers", recruitmentId: id },
    { kind: "undo", recruitmentId: id, target: "night" },
    { kind: "undo", recruitmentId: id, target: "anytime" },
    { kind: "undo", recruitmentId: id, target: "all" },
    { kind: "close", recruitmentId: id },
    { kind: "cancel", recruitmentId: id },
  ];

  it.each(actions)("$kind を往復できる", (action) => {
    expect(parseCustomId(encodeCustomId(action))).toEqual(action);
  });

  it("形式どおりの文字列になる", () => {
    expect(encodeCustomId({ kind: "hour", recruitmentId: "123", hour: 21 })).toBe("h:123:21");
    expect(encodeCustomId({ kind: "select", recruitmentId: "123", bucket: "noon" })).toBe("s:123:noon");
    expect(encodeCustomId({ kind: "cancel", recruitmentId: "123" })).toBe("x:123");
    expect(encodeCustomId({ kind: "manageAnswers", recruitmentId: "123" })).toBe("m:123");
    expect(encodeCustomId({ kind: "undo", recruitmentId: "123", target: "all" })).toBe("u:123:all");
  });

  it("特別な取り消し対象は時間帯のキーと衝突しない", () => {
    expect(BUCKETS.map((bucket) => bucket.key)).not.toContain("anytime");
    expect(BUCKETS.map((bucket) => bucket.key)).not.toContain("all");
  });

  it.each([
    "",
    "h",
    "h:123",
    "h:123:abc",
    "n:123:evening",
    "s:123",
    "p:123:1",
    "q:123",
    "p:abc",
    "a:123:night:1",
    "h::21",
    "u:123:other",
    "u:123",
    "m:123:night",
  ])("壊れた入力 %j は null", (input) => {
    expect(parseCustomId(input)).toBeNull();
  });
});

describe("セレクトの値", () => {
  const values: SelectValue[] = [{ kind: "hour", hour: 25 }, { kind: "now" }, { kind: "none" }];

  it.each(values)("$kind を往復できる", (value) => {
    expect(parseSelectValue(encodeSelectValue(value))).toEqual(value);
  });

  it.each(["", "later", "-1", "1.5"])("壊れた入力 %j は null", (input) => {
    expect(parseSelectValue(input)).toBeNull();
  });
});
