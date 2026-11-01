// Workers は UTC で動くので、JST の「今日」は固定オフセットで求める（日本に夏時間はない）
const JST_OFFSET_MS = 9 * 60 * 60 * 1000;
const WEEKDAYS = ["日", "月", "火", "水", "木", "金", "土"];

function toIsoDate(utcMs: number): string {
  return new Date(utcMs).toISOString().slice(0, 10);
}

function jstMidnightUtcMs(now: Date): number {
  const jst = new Date(now.getTime() + JST_OFFSET_MS);
  return Date.UTC(jst.getUTCFullYear(), jst.getUTCMonth(), jst.getUTCDate());
}

/** 「11/3」「明日」などを YYYY-MM-DD にする。解釈できなければ null */
export function parseDateInput(input: string | undefined, now: Date): string | null {
  const text = (input ?? "").normalize("NFKC").trim();
  const today = jstMidnightUtcMs(now);
  if (text === "" || text === "今日") return toIsoDate(today);
  if (text === "明日") return toIsoDate(today + 24 * 60 * 60 * 1000);

  const match = /^(\d{1,2})\/(\d{1,2})$/.exec(text);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
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
  const d = new Date(`${isoDate}T00:00:00Z`);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAYS[d.getUTCDay()]})`;
}
