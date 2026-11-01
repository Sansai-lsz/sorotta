import { bucketsOf, isHourOver, type BucketKey, type Scope } from "./buckets.ts";
import { clockOf } from "./date.ts";
import type { Recruitment } from "./recruitment.ts";

export type Slot = { hour: number; now: boolean };

/** 配列は最初に回答した順に並んでいる前提。passed のときは anytime=false・slots 空 */
export type Participant = {
  userId: string;
  passed: boolean;
  anytime: boolean;
  slots: Partial<Record<BucketKey, Slot>>;
};

export type Ready = { bucket: BucketKey; hour: number; members: string[]; reserves: string[] };

export type Tally = { ready: Ready | null; best: number; passed: string[]; anytime: string[] };

/**
 * 開始時刻が早い人はそれ以降の時刻にも参加できるとみなす。
 * ただし時間帯をまたいでは数えない（朝から来られる人が夜も空いているとは限らないため）。
 * clock が null なら過ぎた時刻も数える（締め切り・中止の後も結果を残すため）
 */
export function tally(input: {
  scope: Scope;
  participants: Participant[];
  min: number;
  max: number | null;
  clock: number | null;
}): Tally {
  const { scope, participants, min, max, clock } = input;
  const active = participants.filter((p) => !p.passed);
  let best = 0;
  let ready: Ready | null = null;
  for (const bucket of bucketsOf(scope)) {
    for (const hour of bucket.hours) {
      if (clock !== null && isHourOver(hour, clock)) continue;
      const available = active.filter((p) => p.anytime || (p.slots[bucket.key]?.hour ?? Infinity) <= hour).map((p) => p.userId);
      best = Math.max(best, available.length);
      if (ready === null && available.length >= min) {
        const cap = max ?? available.length;
        ready = { bucket: bucket.key, hour, members: available.slice(0, cap), reserves: available.slice(cap) };
      }
    }
  }
  return {
    ready,
    best,
    passed: participants.filter((p) => p.passed).map((p) => p.userId),
    anytime: active.filter((p) => p.anytime).map((p) => p.userId),
  };
}

export function tallyRecruitment(rec: Recruitment, participants: Participant[], now: Date): Tally {
  const clock = rec.status === "open" ? clockOf(rec.date, now) : null;
  return tally({ scope: rec.scope, participants, min: rec.min, max: rec.max, clock });
}

export function cancelNoticeTargets(rec: { hostId: string }, participants: Participant[]): string[] {
  return participants
    .filter((p) => !p.passed && p.userId !== rec.hostId && (p.anytime || Object.keys(p.slots).length > 0))
    .map((p) => p.userId);
}
