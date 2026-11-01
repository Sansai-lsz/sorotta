import { bucketsOf, isHourOver, type BucketKey, type Scope } from "./buckets.ts";
import { hoursSinceDateStart } from "./date.ts";
import type { ReadySlot, Recruitment } from "./recruitment.ts";

export type Slot = { hour: number; now: boolean };

export type ActiveParticipant = {
  userId: string;
  passed: false;
  anytime: boolean;
  slots: Partial<Record<BucketKey, Slot>>;
};

/** 配列は最初に回答した順に並んでいる前提 */
export type Participant = { userId: string; passed: true } | ActiveParticipant;

export function activeParticipants(participants: Participant[]): ActiveParticipant[] {
  return participants.filter((p): p is ActiveParticipant => !p.passed);
}

export type Ready = { bucket: BucketKey; hour: number; members: string[]; reserves: string[] };

export type Outcome = { kind: "ready"; ready: Ready } | { kind: "short"; missing: number } | { kind: "missed" };

export type Tally = { outcome: Outcome; passed: string[]; anytime: string[] };

type TallyInput = { participants: Participant[]; min: number; max: number | null };

function availableAt(active: ActiveParticipant[], bucket: BucketKey, hour: number): string[] {
  return active.filter((p) => p.anytime || (p.slots[bucket]?.hour ?? Infinity) <= hour).map((p) => p.userId);
}

function readyOf(slot: ReadySlot, available: string[], max: number | null): Ready {
  const cap = max ?? available.length;
  return { ...slot, members: available.slice(0, cap), reserves: available.slice(cap) };
}

function withLists(participants: Participant[], outcome: Outcome): Tally {
  return {
    outcome,
    passed: participants.filter((p) => p.passed).map((p) => p.userId),
    anytime: activeParticipants(participants)
      .filter((p) => p.anytime)
      .map((p) => p.userId),
  };
}

/**
 * 開始時刻が早い人はそれ以降の時刻にも参加できるとみなす。
 * ただし時間帯をまたいでは数えない（朝から来られる人が夜も空いているとは限らないため）
 */
export function tally(input: TallyInput & { scope: Scope; clock: number }): Tally {
  const { scope, participants, min, max, clock } = input;
  const active = activeParticipants(participants);
  let best = 0;
  for (const bucket of bucketsOf(scope)) {
    for (const hour of bucket.hours) {
      if (isHourOver(hour, clock)) continue;
      const available = availableAt(active, bucket.key, hour);
      if (available.length >= min) {
        return withLists(participants, { kind: "ready", ready: readyOf({ bucket: bucket.key, hour }, available, max) });
      }
      best = Math.max(best, available.length);
    }
  }
  return withLists(participants, { kind: "short", missing: min - best });
}

/** 終わった募集は通知した時刻だけを見て、今もそろっていればその結果を残す */
export function tallyEnded(input: TallyInput & { notifiedSlot: ReadySlot | null }): Tally {
  const { participants, min, max, notifiedSlot } = input;
  if (notifiedSlot === null) return withLists(participants, { kind: "missed" });
  const available = availableAt(activeParticipants(participants), notifiedSlot.bucket, notifiedSlot.hour);
  return withLists(
    participants,
    available.length >= min ? { kind: "ready", ready: readyOf(notifiedSlot, available, max) } : { kind: "missed" },
  );
}

/** 受付中なら募集日 0 時からの経過時間、終わっていれば null */
export function recruitmentClock(rec: Recruitment, now: Date): number | null {
  return rec.status === "open" ? hoursSinceDateStart(rec.date, now) : null;
}

export function tallyRecruitment(rec: Recruitment, participants: Participant[], now: Date): Tally {
  const clock = recruitmentClock(rec, now);
  const input = { participants, min: rec.min, max: rec.max };
  return clock === null
    ? tallyEnded({ ...input, notifiedSlot: rec.notifiedSlot })
    : tally({ ...input, scope: rec.scope, clock });
}

export function cancelNoticeTargets(rec: { hostId: string }, participants: Participant[]): string[] {
  return activeParticipants(participants)
    .filter((p) => p.userId !== rec.hostId && (p.anytime || Object.keys(p.slots).length > 0))
    .map((p) => p.userId);
}
