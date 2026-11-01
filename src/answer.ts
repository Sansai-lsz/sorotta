import { bucketOf, bucketsOf, hasHour, isHourOver, nowHourIn, type BucketKey, type Scope } from "./buckets.ts";
import type { SelectValue } from "./customId.ts";

export type AnswerOp =
  | { kind: "slot"; bucket: BucketKey; hour: number; now: boolean }
  | { kind: "clear"; bucket: BucketKey }
  | { kind: "toggleAnytime" }
  | { kind: "pass" };

// セレクトで選ばれた値は custom_id ではなく interaction.data.values で届くので、ここで 1 つにまとめる
export type AnswerAction =
  | { kind: "hour"; hour: number }
  | { kind: "now"; bucket: BucketKey }
  | { kind: "select"; bucket: BucketKey; value: SelectValue }
  | { kind: "anytime" }
  | { kind: "pass" };

export type AnswerResult = { ok: true; op: AnswerOp } | { ok: false; message: string };

const INVALID: AnswerResult = { ok: false, message: "このボタンは使えません" };

function inScope(scope: Scope, bucket: BucketKey): boolean {
  return bucketsOf(scope).some((b) => b.key === bucket);
}

function slotAt(bucket: BucketKey, hour: number, clock: number): AnswerResult {
  if (!hasHour(bucketOf(bucket), hour)) return INVALID;
  if (isHourOver(hour, clock)) return { ok: false, message: "その時刻はもう過ぎています" };
  return { ok: true, op: { kind: "slot", bucket, hour, now: false } };
}

function slotNow(bucket: BucketKey, clock: number): AnswerResult {
  const hour = nowHourIn(bucketOf(bucket), clock);
  if (hour === null) return { ok: false, message: "今はその時間帯ではありません" };
  return { ok: true, op: { kind: "slot", bucket, hour, now: true } };
}

export function resolveAnswer(action: AnswerAction, rec: { scope: Scope }, clock: number): AnswerResult {
  switch (action.kind) {
    case "hour":
      return rec.scope === "any" ? INVALID : slotAt(rec.scope, action.hour, clock);
    case "now":
      return inScope(rec.scope, action.bucket) ? slotNow(action.bucket, clock) : INVALID;
    case "select": {
      if (!inScope(rec.scope, action.bucket)) return INVALID;
      switch (action.value.kind) {
        case "hour":
          return slotAt(action.bucket, action.value.hour, clock);
        case "now":
          return slotNow(action.bucket, clock);
        case "none":
          return { ok: true, op: { kind: "clear", bucket: action.bucket } };
      }
    }
    case "anytime":
      return rec.scope === "any" ? { ok: true, op: { kind: "toggleAnytime" } } : INVALID;
    case "pass":
      return { ok: true, op: { kind: "pass" } };
  }
}
