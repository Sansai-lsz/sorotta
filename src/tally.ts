// 24 は翌0時。日付をまたいでも同じ募集の中で数えるため、時刻は整数のまま扱う
export const HOURS = [20, 21, 22, 23, 24] as const;

export type Entry = { userId: string; hour: number | null };

export type Tally = {
  byHour: Map<number, string[]>;
  passed: string[];
  participantCount: number;
  ready: { hour: number; userIds: string[] } | null;
};

export function isValidHour(hour: number): boolean {
  return HOURS.some((h) => h === hour);
}

export function tally(entries: Entry[], required: number): Tally {
  const byHour = new Map<number, string[]>();
  const passed: string[] = [];
  for (const entry of entries) {
    if (entry.hour === null) {
      passed.push(entry.userId);
      continue;
    }
    if (!isValidHour(entry.hour)) continue;
    const users = byHour.get(entry.hour) ?? [];
    users.push(entry.userId);
    byHour.set(entry.hour, users);
  }

  const available: string[] = [];
  let ready: Tally["ready"] = null;
  for (const hour of HOURS) {
    available.push(...(byHour.get(hour) ?? []));
    if (ready === null && available.length >= required) {
      ready = { hour, userIds: [...available] };
    }
  }

  return { byHour, passed, participantCount: available.length, ready };
}
