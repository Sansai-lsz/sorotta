import { ButtonStyle, ComponentType, type APIInteractionResponseCallbackData } from "discord-api-types/v10";
import { bucketOf, shortHourLabel } from "../domain/buckets.ts";
import { encodeCustomId } from "../discord/customId.ts";
import type { Recruitment } from "../domain/recruitment.ts";
import type { Ready } from "../domain/tally.ts";
import { button, mention, mentions } from "./shared.ts";

export function renderReadyNotice(rec: Recruitment, ready: Ready): APIInteractionResponseCallbackData {
  const where = rec.scope === "any" ? `${bucketOf(ready.bucket).label} ` : "";
  return {
    content: `🎮 ${rec.game} ${where}${shortHourLabel(ready.hour)}で${ready.members.length}人そろいました！ ${mentions(ready.members)}`,
    allowed_mentions: { users: ready.members },
  };
}

export function renderCancelNotice(rec: Recruitment, userIds: string[]): APIInteractionResponseCallbackData {
  return {
    content: [`${rec.game} の募集は中止になりました`, ...userIds.map(mention)].join(" "),
    allowed_mentions: { users: userIds },
  };
}

export function endedNotice(status: "closed" | "cancelled"): string {
  return status === "closed" ? "この募集は締め切られています" : "この募集は中止されています";
}

export function renderFinishResult(
  status: "closed" | "cancelled",
  delivered: { board: boolean; notice: boolean },
): string {
  const done = status === "closed" ? "締め切りました" : "中止しました";
  if (delivered.board && delivered.notice) return done;
  const problem =
    !delivered.board && !delivered.notice
      ? "募集の投稿を書き換えられず、中止の通知も送れませんでした"
      : !delivered.board
        ? "募集の投稿を書き換えられませんでした"
        : "中止の通知を送れませんでした";
  return `${done}。ただし${problem}（bot の権限を確認してください）`;
}

export function renderManagePanel(rec: Recruitment): APIInteractionResponseCallbackData {
  return {
    content: "この募集を管理",
    components: [
      {
        type: ComponentType.ActionRow,
        components: [
          button(ButtonStyle.Secondary, "締め切る", encodeCustomId({ kind: "close", recruitmentId: rec.id })),
          button(ButtonStyle.Danger, "中止", encodeCustomId({ kind: "cancel", recruitmentId: rec.id })),
        ],
      },
    ],
    allowed_mentions: { parse: [] },
  };
}
