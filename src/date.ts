// Workers は UTC で動くので、JST の「今日」は固定オフセットで求める（日本に夏時間はない）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
// 深夜 0〜5 時に遊ぶ話は前日の続きとして扱うため、日付の切り替わりを 6 時にずらす
const GAME_DAY_START_HOUR = 6;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function toIsoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function isoDateMs(isoDate: string): number {
  return Date.parse(`${isoDate}T00:00:00Z`);
}

/** JST の 6:00 から翌 5:59 までを 1 日とみなした今日の日付（YYYY-MM-DD） */
export function gameToday(now: Date): string {
  return toIsoDate(now.getTime() + JST_OFFSET_MS - GAME_DAY_START_HOUR * HOUR_MS);
}

/** 募集日 isoDate の JST 0:00 から now までの経過時間（時間単位）。翌 1:00 は 25 */
export function clockOf(isoDate: string, now: Date): number {
  return (now.getTime() - (isoDateMs(isoDate) - JST_OFFSET_MS)) / HOUR_MS;
}

export function addDays(isoDate: string, days: number): string {
  return toIsoDate(isoDateMs(isoDate) + days * DAY_MS);
}

/** 「11/3」「明日」などを YYYY-MM-DD にする。解釈できなければ null */
export function parseDateInput(input: string | undefined, now: Date): string | null {
  const text = (input ?? "").normalize("NFKC").trim();
  const todayIso = gameToday(now);
  if (text === "" || text === "今日") return todayIso;
  if (text === "明日") return addDays(todayIso, 1);

  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const today = isoDateMs(todayIso);
  const year = new Date(today).getUTCFullYear();
  for (const y of [year, year + 1]) {
    const candidate = Date.UTC(y, month - 1, day);
    const d = new Date(candidate);
    if (d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) continue;
    if (candidate >= today) return toIsoDate(candidate);
  }
  return null;
}

/** YYYY-MM-DD を「11/3(月)」にする */
export function formatDate(isoDate: string): string {
  const d = new Date(isoDateMs(isoDate));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}

/** YYYY-MM-DD を「11/3」にする */
export function formatMonthDay(isoDate: string): string {
  const d = new Date(isoDateMs(isoDate));
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}
