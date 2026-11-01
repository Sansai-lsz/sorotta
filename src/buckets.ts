import { addDays, clockOf, formatMonthDay, gameToday } from "./date.ts";

// 深夜は募集日の翌日 0〜5 時だが、同じ募集の中で並べて数えるため 24〜29 として扱う
export const BUCKETS = [
  { key: "morning", label: "朝", emoji: "🌅", hours: [6, 7, 8, 9, 10, 11] },
  { key: "noon", label: "昼", emoji: "☀️", hours: [12, 13, 14, 15, 16, 17] },
  { key: "night", label: "夜", emoji: "🌙", hours: [18, 19, 20, 21, 22, 23] },
  { key: "late", label: "深夜", emoji: "🌌", hours: [24, 25, 26, 27, 28, 29] },
] as const;

export type Bucket = (typeof BUCKETS)[number];
export type BucketKey = Bucket["key"];
export type Scope = BucketKey | "any";

const MIN_OPEN_HOURS_FOR_AUTO = 3;

export function isBucketKey(s: string): s is BucketKey {
  return BUCKETS.some((b) => b.key === s);
}

export function isScope(s: string): s is Scope {
  return s === "any" || isBucketKey(s);
}

export function bucketOf(key: BucketKey): Bucket {
  const bucket = BUCKETS.find((b) => b.key === key);
  if (!bucket) throw new Error(`unknown bucket: ${key}`);
  return bucket;
}

export function bucketsOf(scope: Scope): readonly Bucket[] {
  return scope === "any" ? BUCKETS : BUCKETS.filter((b) => b.key === scope);
}

export function hasHour(bucket: Bucket, hour: number): boolean {
  return bucket.hours.some((h) => h === hour);
}

export function isHourOver(hour: number, clock: number): boolean {
  return hour + 1 <= clock;
}

export function openHours(bucket: Bucket, clock: number): number[] {
  return bucket.hours.filter((h) => !isHourOver(h, clock));
}

export function nowHourIn(bucket: Bucket, clock: number): number | null {
  const hour = Math.floor(clock);
  return hasHour(bucket, hour) ? hour : null;
}

export function isScopeOver(scope: Scope, clock: number): boolean {
  return bucketsOf(scope).every((b) => b.hours.every((h) => isHourOver(h, clock)));
}

export function hourLabel(hour: number, date: string): string {
  return hour >= 24 ? `${shortHourLabel(hour)}（${formatMonthDay(addDays(date, 1))}）` : shortHourLabel(hour);
}

export function shortHourLabel(hour: number): string {
  return `${hour >= 24 ? hour - 24 : hour}時〜`;
}

export type PlanResult = { ok: true; date: string; scope: Scope } | { ok: false; error: "over" };

export function planRecruitment(input: { date: string; scope: Scope | undefined }, now: Date): PlanResult {
  const { date, scope } = input;
  const clock = clockOf(date, now);
  if (scope !== undefined) {
    return isScopeOver(scope, clock) ? { ok: false, error: "over" } : { ok: true, date, scope };
  }
  if (date !== gameToday(now)) return { ok: true, date, scope: "night" };

  const current = BUCKETS.find((b) => nowHourIn(b, clock) !== null);
  if (current && openHours(current, clock).length >= MIN_OPEN_HOURS_FOR_AUTO) {
    return { ok: true, date, scope: current.key };
  }
  const next = BUCKETS.find((b) => b.hours[0] > clock);
  if (next) return { ok: true, date, scope: next.key };
  return { ok: true, date: addDays(date, 1), scope: "morning" };
}
