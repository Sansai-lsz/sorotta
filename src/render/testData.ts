import type { Recruitment } from "../domain/recruitment.ts";
import type { ActiveParticipant, Participant } from "../domain/tally.ts";

export const jst = (local: string) => new Date(`${local}+09:00`);

export const base: Recruitment = {
  id: "123",
  guildId: "g",
  channelId: "c",
  messageId: null,
  game: "Apex",
  min: 3,
  max: 3,
  date: "2026-11-01",
  scope: "night",
  hostId: "host",
  status: "open",
  notifiedSlot: null,
};
export const anyRec: Recruitment = { ...base, scope: "any" };
export const lateRec: Recruitment = { ...base, scope: "late" };

export const at = (userId: string, slots: ActiveParticipant["slots"]): Participant => ({
  userId,
  passed: false,
  anytime: false,
  slots,
});
export const night = (hour: number, now = false) => ({ night: { hour, now } });
