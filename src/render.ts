import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIEmbed,
  type APIInteractionResponseCallbackData,
} from "discord-api-types/v10";
import { formatDate } from "./date.ts";
import { HOURS, tally, type Entry } from "./tally.ts";

export type Recruitment = {
  id: string;
  game: string;
  required: number;
  date: string;
  recruiterId: string;
};

const BUTTONS_PER_ROW = 5;

export function hourLabel(hour: number): string {
  return `${hour}時〜`;
}

function mention(userId: string): string {
  return `<@${userId}>`;
}

export function joinCustomId(recruitmentId: string, hour: number): string {
  return `j:${recruitmentId}:${hour}`;
}

export function passCustomId(recruitmentId: string): string {
  return `p:${recruitmentId}`;
}

export type ButtonAction =
  | { kind: "join"; recruitmentId: string; hour: number }
  | { kind: "pass"; recruitmentId: string };

export function parseCustomId(customId: string): ButtonAction | null {
  const [kind, recruitmentId, hour] = customId.split(":");
  if (!recruitmentId) return null;
  if (kind === "p") return { kind: "pass", recruitmentId };
  if (kind === "j" && hour !== undefined && /^\d+$/.test(hour)) {
    return { kind: "join", recruitmentId, hour: Number(hour) };
  }
  return null;
}

export function renderBoard(
  rec: Recruitment,
  entries: Entry[],
): APIInteractionResponseCallbackData {
  const t = tally(entries, rec.required);

  const lines = [`募集: ${mention(rec.recruiterId)}（${rec.required}人そろえば開始）`, ""];
  for (const hour of HOURS) {
    const users = t.byHour.get(hour) ?? [];
    lines.push(`**${hourLabel(hour)}**　${users.length > 0 ? users.map(mention).join(" ") : "－"}`);
  }
  lines.push("");
  lines.push(
    t.ready
      ? `✅ **${hourLabel(t.ready.hour)}なら ${t.ready.userIds.length}人そろう**`
      : `あと ${rec.required - t.participantCount}人`,
  );
  if (t.passed.length > 0) {
    lines.push(`パス: ${t.passed.map(mention).join(" ")}`);
  }

  const embed: APIEmbed = {
    title: `🎮 ${rec.game} やる人？ ${formatDate(rec.date)}`,
    description: lines.join("\n"),
    color: t.ready ? 0x57f287 : 0x5865f2,
  };

  const hourButtons: APIButtonComponent[] = HOURS.map((hour) => ({
    type: ComponentType.Button,
    style: ButtonStyle.Primary,
    label: hourLabel(hour),
    custom_id: joinCustomId(rec.id, hour),
  }));
  const rows: APIActionRowComponent<APIButtonComponent>[] = [];
  for (let i = 0; i < hourButtons.length; i += BUTTONS_PER_ROW) {
    rows.push({ type: ComponentType.ActionRow, components: hourButtons.slice(i, i + BUTTONS_PER_ROW) });
  }
  rows.push({
    type: ComponentType.ActionRow,
    components: [
      {
        type: ComponentType.Button,
        style: ButtonStyle.Secondary,
        label: "今日はパス",
        custom_id: passCustomId(rec.id),
      },
    ],
  });

  // 一覧のメンションは名前表示のためだけに使う。押すたびに全員へ通知が飛ばないよう抑止する
  return { embeds: [embed], components: rows, allowed_mentions: { parse: [] } };
}

export function renderReadyNotice(game: string, hour: number, userIds: string[]): APIInteractionResponseCallbackData {
  return {
    content: `🎮 ${game} ${hourLabel(hour)}で${userIds.length}人そろいました！ ${userIds.map(mention).join(" ")}`,
    allowed_mentions: { users: userIds },
  };
}
