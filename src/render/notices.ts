import {
  ButtonStyle,
  ComponentType,
  MessageFlags,
  type APIInteractionResponseCallbackData,
} from "discord-api-types/v10";
import { bucketOf, bucketsOf, hourLabel, shortHourLabel } from "../domain/buckets.ts";
import type { UndoTarget } from "../domain/answer.ts";
import { encodeCustomId } from "../discord/customId.ts";
import type { Recruitment } from "../domain/recruitment.ts";
import type { Participant, Ready } from "../domain/tally.ts";
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

export function renderUndoPanel(
  rec: Recruitment,
  participant: Participant | undefined,
): APIInteractionResponseCallbackData {
  const text = (content: string) => ({ type: ComponentType.TextDisplay as const, content });
  const section = (content: string, target: UndoTarget) => ({
    type: ComponentType.Section as const,
    components: [text(content)],
    accessory: button(
      ButtonStyle.Secondary,
      "取り消す",
      encodeCustomId({ kind: "undo", recruitmentId: rec.id, target }),
    ),
  });
  const answers = participant?.passed
    ? [section("今日はパス", "pass")]
    : [
        ...bucketsOf(rec.scope).flatMap((bucket) => {
          const slot = participant?.slots[bucket.key];
          if (!slot) return [];
          const label = rec.scope === "any" ? `${bucket.emoji} ${bucket.label}　` : "";
          return [section(`${label}${hourLabel(slot.hour, rec.date)}${slot.now ? " ⚡今すぐ" : ""}`, bucket.key)];
        }),
        ...(participant?.anytime ? [section("🙆 いつでもOK", "anytime")] : []),
      ];
  return {
    flags: MessageFlags.IsComponentsV2,
    components: [
      text("あなたの回答"),
      ...(answers.length === 0 ? [text("まだ回答していません")] : answers),
      ...(answers.length >= 2
        ? [
            {
              type: ComponentType.ActionRow as const,
              components: [
                button(
                  ButtonStyle.Secondary,
                  "全部取り消す",
                  encodeCustomId({ kind: "undo", recruitmentId: rec.id, target: "all" }),
                ),
              ],
            },
          ]
        : []),
    ],
    allowed_mentions: { parse: [] },
  };
}
