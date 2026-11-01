import { describe, expect, it } from "vitest";
import { cancelNoticeTargets, tally, type Participant } from "./tally.ts";

const at = (userId: string, slots: Participant["slots"]): Participant => ({ userId, passed: false, anytime: false, slots });
const anytime = (userId: string): Participant => ({ userId, passed: false, anytime: true, slots: {} });
const passed = (userId: string): Participant => ({ userId, passed: true, anytime: false, slots: {} });
const night = (hour: number) => ({ night: { hour, now: false } });

describe("tally", () => {
  const base = { scope: "night", min: 3, max: null, clock: null } as const;

  it("早い時刻から来られる人も同じ時間帯の後の時刻に数え、最初にそろう時刻を返す", () => {
    const t = tally({ ...base, participants: [at("a", night(20)), at("b", night(22)), at("c", night(21)), at("d", night(23))] });
    expect(t.ready).toEqual({ bucket: "night", hour: 22, members: ["a", "b", "c"], reserves: [] });
    expect(t.best).toBe(4);
  });

  it("時間帯をまたいでは数えない", () => {
    const t = tally({
      ...base,
      scope: "any",
      min: 2,
      participants: [at("a", { noon: { hour: 12, now: false } }), at("b", night(18))],
    });
    expect(t.ready).toBeNull();
    expect(t.best).toBe(1);
  });

  it("いつでもOK の人はすべての時間帯・時刻で数える", () => {
    const t = tally({ ...base, scope: "any", min: 2, participants: [anytime("x"), at("a", { noon: { hour: 15, now: false } })] });
    expect(t.ready).toEqual({ bucket: "noon", hour: 15, members: ["x", "a"], reserves: [] });
    expect(t.anytime).toEqual(["x"]);
  });

  it("clock を指定すると過ぎた時刻は数えない", () => {
    const t = tally({ ...base, min: 2, clock: 22, participants: [at("a", night(20)), at("b", night(21))] });
    expect(t.ready).toEqual({ bucket: "night", hour: 22, members: ["a", "b"], reserves: [] });
  });

  it("clock が null なら過ぎた時刻も数える", () => {
    const t = tally({ ...base, min: 2, participants: [at("a", night(20)), at("b", night(21))] });
    expect(t.ready?.hour).toBe(21);
  });

  it("時系列で最初にそろう時間帯を返す", () => {
    const t = tally({
      ...base,
      scope: "any",
      min: 1,
      participants: [at("a", { late: { hour: 24, now: false } }), at("b", { morning: { hour: 9, now: false } })],
    });
    expect(t.ready).toEqual({ bucket: "morning", hour: 9, members: ["b"], reserves: [] });
  });

  it("定員を超えたら回答順で後の人を補欠にする", () => {
    const t = tally({ ...base, min: 2, max: 2, participants: [at("a", night(21)), at("b", night(21)), at("c", night(20))] });
    expect(t.ready).toEqual({ bucket: "night", hour: 21, members: ["a", "b"], reserves: ["c"] });
  });

  it("パスした人は数えない", () => {
    const t = tally({ ...base, min: 1, participants: [passed("d")] });
    expect(t.ready).toBeNull();
    expect(t.best).toBe(0);
    expect(t.passed).toEqual(["d"]);
  });

  it("最少人数ちょうどでそろったとみなす", () => {
    const t = tally({ ...base, min: 1, participants: [at("a", night(23))] });
    expect(t.ready).toEqual({ bucket: "night", hour: 23, members: ["a"], reserves: [] });
  });
});

describe("cancelNoticeTargets", () => {
  it("回答していて、パスでも募集した本人でもない人に送る", () => {
    const participants = [at("host", night(21)), at("a", night(22)), anytime("x"), passed("d"), at("empty", {})];
    expect(cancelNoticeTargets({ hostId: "host" }, participants)).toEqual(["a", "x"]);
  });
});
