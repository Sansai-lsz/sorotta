import { describe, expect, it } from "vitest";
import type { Recruitment } from "./recruitment.ts";
import {
  cancelNoticeTargets,
  tally,
  tallyEnded,
  tallyRecruitment,
  type ActiveParticipant,
  type Participant,
} from "./tally.ts";

const at = (userId: string, slots: ActiveParticipant["slots"]): Participant => ({
  userId,
  passed: false,
  anytime: false,
  slots,
});
const anytime = (userId: string): Participant => ({ userId, passed: false, anytime: true, slots: {} });
const passed = (userId: string): Participant => ({ userId, passed: true });
const night = (hour: number) => ({ night: { hour, now: false } });

describe("tally", () => {
  const base = { scope: "night", min: 3, max: null, clock: 0 } as const;

  it("早い時刻から来られる人も同じ時間帯の後の時刻に数え、最初にそろう時刻を返す", () => {
    const t = tally({
      ...base,
      participants: [at("a", night(20)), at("b", night(22)), at("c", night(21)), at("d", night(23))],
    });
    expect(t.outcome).toEqual({
      kind: "ready",
      ready: { bucket: "night", hour: 22, members: ["a", "b", "c"], reserves: [] },
    });
  });

  it("時間帯をまたいでは数えない", () => {
    const t = tally({
      ...base,
      scope: "any",
      min: 2,
      participants: [at("a", { noon: { hour: 12, now: false } }), at("b", night(18))],
    });
    expect(t.outcome).toEqual({ kind: "short", missing: 1 });
  });

  it("いつでもOK の人はすべての時間帯・時刻で数える", () => {
    const t = tally({
      ...base,
      scope: "any",
      min: 2,
      participants: [anytime("x"), at("a", { noon: { hour: 15, now: false } })],
    });
    expect(t.outcome).toEqual({
      kind: "ready",
      ready: { bucket: "noon", hour: 15, members: ["x", "a"], reserves: [] },
    });
    expect(t.anytime).toEqual(["x"]);
  });

  it("過ぎた時刻は数えない", () => {
    const t = tally({ ...base, min: 2, clock: 22, participants: [at("a", night(20)), at("b", night(21))] });
    expect(t.outcome).toEqual({
      kind: "ready",
      ready: { bucket: "night", hour: 22, members: ["a", "b"], reserves: [] },
    });
  });

  it("時系列で最初にそろう時間帯を返す", () => {
    const t = tally({
      ...base,
      scope: "any",
      min: 1,
      participants: [at("a", { late: { hour: 24, now: false } }), at("b", { morning: { hour: 9, now: false } })],
    });
    expect(t.outcome).toEqual({ kind: "ready", ready: { bucket: "morning", hour: 9, members: ["b"], reserves: [] } });
  });

  it("定員を超えたら回答順で後の人を補欠にする", () => {
    const t = tally({
      ...base,
      min: 2,
      max: 2,
      participants: [at("a", night(21)), at("b", night(21)), at("c", night(20))],
    });
    expect(t.outcome).toEqual({
      kind: "ready",
      ready: { bucket: "night", hour: 21, members: ["a", "b"], reserves: ["c"] },
    });
  });

  it("パスした人は数えない", () => {
    const t = tally({ ...base, min: 1, participants: [passed("d")] });
    expect(t.outcome).toEqual({ kind: "short", missing: 1 });
    expect(t.passed).toEqual(["d"]);
  });

  it("最少人数ちょうどでそろったとみなす", () => {
    const t = tally({ ...base, min: 1, participants: [at("a", night(23))] });
    expect(t.outcome).toEqual({ kind: "ready", ready: { bucket: "night", hour: 23, members: ["a"], reserves: [] } });
  });
});

describe("tallyEnded", () => {
  const base = { min: 2, max: null } as const;

  it("通知した時刻に今も最少人数がいればその結果を残す", () => {
    const t = tallyEnded({
      ...base,
      notifiedSlot: { bucket: "night", hour: 20 },
      participants: [anytime("x"), at("a", night(20)), at("b", night(22))],
    });
    expect(t.outcome).toEqual({
      kind: "ready",
      ready: { bucket: "night", hour: 20, members: ["x", "a"], reserves: [] },
    });
  });

  it("通知した後に抜けて最少人数を下回ればそろわなかった扱い", () => {
    const t = tallyEnded({
      ...base,
      notifiedSlot: { bucket: "night", hour: 20 },
      participants: [anytime("x"), passed("a")],
    });
    expect(t.outcome).toEqual({ kind: "missed" });
  });

  it("通知していなければ過ぎた時刻でそろっていてもそろわなかった扱い", () => {
    const t = tallyEnded({ ...base, notifiedSlot: null, participants: [anytime("x"), anytime("y")] });
    expect(t.outcome).toEqual({ kind: "missed" });
  });

  it("定員を超えた分は回答順で補欠にする", () => {
    const t = tallyEnded({
      min: 1,
      max: 1,
      notifiedSlot: { bucket: "night", hour: 21 },
      participants: [at("a", night(21)), anytime("x")],
    });
    expect(t.outcome).toEqual({ kind: "ready", ready: { bucket: "night", hour: 21, members: ["a"], reserves: ["x"] } });
  });
});

describe("tallyRecruitment", () => {
  const rec: Recruitment = {
    id: "1",
    guildId: "g",
    channelId: "c",
    messageId: null,
    game: "Apex",
    min: 2,
    max: null,
    date: "2026-11-01",
    scope: "any",
    hostId: "x",
    notifyRoleId: null,
    status: "open",
    notifiedSlot: null,
  };
  const participants = [anytime("x"), anytime("y")];
  const evening = new Date("2026-11-01T20:30:00+09:00");

  it("受付中は今より後の時刻で数える", () => {
    expect(tallyRecruitment(rec, participants, evening).outcome).toMatchObject({
      kind: "ready",
      ready: { bucket: "night", hour: 20 },
    });
  });

  it("終わった募集は過ぎた朝の時刻ではなく通知した時刻を結果にする", () => {
    const closed: Recruitment = { ...rec, status: "closed", notifiedSlot: { bucket: "night", hour: 20 } };
    expect(tallyRecruitment(closed, participants, evening).outcome).toMatchObject({
      kind: "ready",
      ready: { bucket: "night", hour: 20 },
    });
  });
});

describe("cancelNoticeTargets", () => {
  it("回答していて、パスでも募集した本人でもない人に送る", () => {
    const participants = [at("host", night(21)), at("a", night(22)), anytime("x"), passed("d"), at("empty", {})];
    expect(cancelNoticeTargets({ hostId: "host" }, participants)).toEqual(["a", "x"]);
  });
});
