import type { Scope } from "./buckets.ts";

export type RecruitmentStatus = "open" | "closed" | "cancelled";

export type Recruitment = {
  id: string;
  guildId: string;
  channelId: string;
  messageId: string | null;
  game: string;
  min: number;
  max: number | null;
  date: string;
  scope: Scope;
  hostId: string;
  status: RecruitmentStatus;
};

export function isRecruitmentStatus(s: string): s is RecruitmentStatus {
  return s === "open" || s === "closed" || s === "cancelled";
}
