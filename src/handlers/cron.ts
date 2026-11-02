import { isScopeOver } from "../domain/buckets.ts";
import { gameToday, hoursSinceDateStart } from "../domain/date.ts";
import { finishRecruitment, listOpenRecruitmentsUntil } from "../db/recruitments.ts";
import { publishBoard } from "./shared.ts";

export async function closeExpired(env: Env, now: Date): Promise<void> {
  const recs = await listOpenRecruitmentsUntil(env.DB, gameToday(now));
  const failed: string[] = [];
  for (const rec of recs) {
    if (!isScopeOver(rec.scope, hoursSinceDateStart(rec.date, now))) continue;
    try {
      if (!(await finishRecruitment(env.DB, rec.id, "closed"))) continue;
      if (!(await publishBoard(env, rec.id, now))) failed.push(rec.id);
    } catch (err: unknown) {
      console.error(`closeExpired ${rec.id} failed`, err);
      failed.push(rec.id);
    }
  }
  if (failed.length > 0) throw new Error(`closeExpired failed for ${failed.join(", ")}`);
}
