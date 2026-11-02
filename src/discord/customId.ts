import type { SelectValue } from "../domain/answer.ts";
import { isBucketKey, type BucketKey } from "../domain/buckets.ts";

export type ComponentAction =
  | { kind: "hour"; recruitmentId: string; hour: number }
  | { kind: "now"; recruitmentId: string; bucket: BucketKey }
  | { kind: "select"; recruitmentId: string; bucket: BucketKey }
  | { kind: "anytime"; recruitmentId: string }
  | { kind: "pass"; recruitmentId: string }
  | { kind: "gear"; recruitmentId: string }
  | { kind: "close"; recruitmentId: string }
  | { kind: "cancel"; recruitmentId: string };

const PREFIX = {
  hour: "h",
  now: "n",
  select: "s",
  anytime: "a",
  pass: "p",
  gear: "g",
  close: "c",
  cancel: "x",
} as const satisfies Record<ComponentAction["kind"], string>;

const NUMBER = /^\d+$/;

export function encodeCustomId(action: ComponentAction): string {
  const head = `${PREFIX[action.kind]}:${action.recruitmentId}`;
  switch (action.kind) {
    case "hour":
      return `${head}:${action.hour}`;
    case "now":
    case "select":
      return `${head}:${action.bucket}`;
    default:
      return head;
  }
}

export function parseCustomId(customId: string): ComponentAction | null {
  const [prefix, recruitmentId, arg, ...rest] = customId.split(":");
  if (recruitmentId === undefined || !NUMBER.test(recruitmentId) || rest.length > 0) return null;
  if (arg === undefined) {
    switch (prefix) {
      case PREFIX.anytime:
        return { kind: "anytime", recruitmentId };
      case PREFIX.pass:
        return { kind: "pass", recruitmentId };
      case PREFIX.gear:
        return { kind: "gear", recruitmentId };
      case PREFIX.close:
        return { kind: "close", recruitmentId };
      case PREFIX.cancel:
        return { kind: "cancel", recruitmentId };
      default:
        return null;
    }
  }
  if (prefix === PREFIX.hour && NUMBER.test(arg)) return { kind: "hour", recruitmentId, hour: Number(arg) };
  if (!isBucketKey(arg)) return null;
  if (prefix === PREFIX.now) return { kind: "now", recruitmentId, bucket: arg };
  if (prefix === PREFIX.select) return { kind: "select", recruitmentId, bucket: arg };
  return null;
}

export function encodeSelectValue(value: SelectValue): string {
  return value.kind === "hour" ? String(value.hour) : value.kind;
}

export function parseSelectValue(value: string): SelectValue | null {
  if (value === "now") return { kind: "now" };
  if (value === "none") return { kind: "none" };
  if (NUMBER.test(value)) return { kind: "hour", hour: Number(value) };
  return null;
}
