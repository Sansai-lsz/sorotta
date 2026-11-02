import {
  ComponentType,
  type APIActionRowComponent,
  type APIComponentInMessageActionRow,
  type APIInteractionResponseCallbackData,
  type APISelectMenuOption,
  type APISeparatorComponent,
  type APITextDisplayComponent,
  ButtonStyle,
  type APIButtonComponent,
  MessageFlags,
  SeparatorSpacingSize,
  type RESTPatchAPIChannelMessageJSONBody,
} from "discord-api-types/v10";
import {
  BUCKETS,
  bucketOf,
  hourLabel,
  isHourOver,
  nowHourIn,
  openHours,
  shortHourLabel,
  type Bucket,
} from "../domain/buckets.ts";
import { encodeCustomId, encodeSelectValue } from "../discord/customId.ts";
import { formatDate } from "../domain/date.ts";
import type { Recruitment } from "../domain/recruitment.ts";
import {
  activeParticipants,
  recruitmentClock,
  tallyRecruitment,
  type Outcome,
  type Participant,
  type Slot,
} from "../domain/tally.ts";

import { button, mention, mentions } from "./shared.ts";

type ActionRow = APIActionRowComponent<APIComponentInMessageActionRow>;

export function playersLabel(min: number, max: number | null): string {
  return max === null ? `${min}人〜` : `${min}人〜・定員${max}人`;
}

export function gameLabel(game: { name: string; min: number; max: number | null }): string {
  return `${game.name}（${playersLabel(game.min, game.max)}）`;
}

const BUTTONS_PER_ROW = 5;
const COLOR_ENDED = 0x99aab5;
const COLOR_READY = 0x57f287;
const COLOR_OPEN = 0x5865f2;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function renderBoard(
  rec: Recruitment,
  participants: Participant[],
  now: Date,
): APIInteractionResponseCallbackData {
  const ended = rec.status !== "open";
  const clock = recruitmentClock(rec, now);
  const t = tallyRecruitment(rec, participants, now);
  const reserves = new Set(t.outcome.kind === "ready" ? t.outcome.ready.reserves : []);
  const over = (hour: number) => clock !== null && isHourOver(hour, clock);
  const answered = activeParticipants(participants);
  const scope = rec.scope;

  const chip = (userId: string, slot: Slot | undefined) =>
    [mention(userId), ...(slot?.now ? ["⚡今すぐ"] : []), ...(reserves.has(userId) ? ["補欠"] : [])].join(" ");
  const row = (label: string, struck: boolean, people: string[], separator: string) =>
    `${struck ? `~~${label}~~` : `**${label}**`}　${people.length > 0 ? people.join(separator) : "－"}`;

  const rows =
    scope === "any"
      ? BUCKETS.map((b) => {
          const here = answered
            .flatMap((p) => {
              const slot = p.slots[b.key];
              return slot ? [{ userId: p.userId, slot }] : [];
            })
            .sort((x, y) => x.slot.hour - y.slot.hour);
          const people = here.map(({ userId, slot }) => `${chip(userId, slot)} ${hourLabel(slot.hour, rec.date)}`);
          return row(`${b.emoji} ${b.label}`, b.hours.every(over), people, "　");
        })
      : bucketOf(scope).hours.map((hour) => {
          const people = answered.flatMap((p) => {
            const slot = p.slots[scope];
            return slot?.hour === hour ? [chip(p.userId, slot)] : [];
          });
          return row(hourLabel(hour, rec.date), over(hour), people, " ");
        });
  if (scope === "any" && t.anytime.length > 0) {
    rows.push(`**🙆 いつでも**　${t.anytime.map((userId) => chip(userId, undefined)).join(" ")}`);
  }

  const resultLines = outcomeLines(rec, t.outcome);
  if (t.passed.length > 0) resultLines.push(`パス: ${mentions(t.passed)}`);
  if (ended)
    resultLines.push("", rec.status === "cancelled" ? "この募集は中止されました" : "この募集は締め切られました");

  const when = scope === "any" ? "いつでも" : `${bucketOf(scope).emoji}${bucketOf(scope).label}`;
  const badge = rec.status === "closed" ? " ［締め切り］" : rec.status === "cancelled" ? " ［中止］" : "";
  const controls =
    clock === null ? [] : scope === "any" ? anyControls(rec, clock) : singleControls(rec, bucketOf(scope), clock);
  const separator: APISeparatorComponent = {
    type: ComponentType.Separator,
    divider: true,
    spacing: SeparatorSpacingSize.Small,
  };
  // 書き換えのたびに同じ行を描き直せるよう、ロールの行は募集に保存したロールから毎回作る
  const roleLine: APITextDisplayComponent[] =
    rec.notifyRoleId === null
      ? []
      : [{ type: ComponentType.TextDisplay, content: `<@&${rec.notifyRoleId}> ${rec.game} の募集が出ました` }];

  // 一覧のメンションは名前表示のためだけに使う。押すたびに全員へ通知が飛ばないよう抑止する
  return {
    flags: MessageFlags.IsComponentsV2,
    allowed_mentions: { parse: [] },
    components: [
      ...roleLine,
      {
        type: ComponentType.Container,
        accent_color: accentColor(ended, t.outcome),
        components: [
          {
            type: ComponentType.TextDisplay,
            content: `### 🎮 ${rec.game} やる人？ ${formatDate(rec.date)} ${when}${badge}\n募集: ${mention(rec.hostId)}（${playersLabel(rec.min, rec.max)}）`,
          },
          separator,
          { type: ComponentType.TextDisplay, content: rows.join("\n") },
          separator,
          { type: ComponentType.TextDisplay, content: resultLines.join("\n") },
          ...(controls.length > 0 ? [separator] : []),
          ...controls,
        ],
      },
    ],
  };
}

// 参加者のメンションは名前表示のためだけなので許さず、募集に保存したロールだけを許す
function roleMentions(rec: Recruitment): { parse: []; roles?: string[] } {
  return rec.notifyRoleId === null ? { parse: [] } : { parse: [], roles: [rec.notifyRoleId] };
}

export function boardInitialPayload(
  rec: Recruitment,
  participants: Participant[],
  now: Date,
): APIInteractionResponseCallbackData {
  return {
    ...renderBoard(rec, participants, now),
    allowed_mentions: roleMentions(rec),
  };
}

// V2 フラグなしで出した旧盤面は content と embeds を空にしないと V2 に切り替えられない
export function boardEditPayload(
  rec: Recruitment,
  participants: Participant[],
  now: Date,
): RESTPatchAPIChannelMessageJSONBody {
  // V2 のメッセージは編集のたびにメンションの記録を components から作り直すので、ロールも許可し続ける。
  // 編集では通知が飛ばないため、ロールに届くのは最初の投稿の 1 回だけのまま
  return { ...renderBoard(rec, participants, now), allowed_mentions: roleMentions(rec), content: null, embeds: [] };
}

function accentColor(ended: boolean, outcome: Outcome): number {
  if (ended) return COLOR_ENDED;
  if (outcome.kind === "ready") return COLOR_READY;
  return COLOR_OPEN;
}

function outcomeLines(rec: Recruitment, outcome: Outcome): string[] {
  switch (outcome.kind) {
    case "ready": {
      const { ready } = outcome;
      const where = rec.scope === "any" ? `${bucketOf(ready.bucket).label} ` : "";
      const lines = [`✅ **${where}${shortHourLabel(ready.hour)}なら ${ready.members.length}人そろう**`];
      if (ready.reserves.length > 0) lines.push(`補欠: ${mentions(ready.reserves)}`);
      return lines;
    }
    case "short":
      return [`あと ${outcome.missing}人`];
    case "missed":
      return ["そろいませんでした"];
  }
}

function footerButtons(rec: Recruitment): APIButtonComponent[] {
  return [
    button(ButtonStyle.Secondary, "回答を取り消す", encodeCustomId({ kind: "manageAnswers", recruitmentId: rec.id })),
    button(ButtonStyle.Secondary, "今日はパス", encodeCustomId({ kind: "pass", recruitmentId: rec.id })),
    button(ButtonStyle.Secondary, "⚙", encodeCustomId({ kind: "gear", recruitmentId: rec.id })),
  ];
}

function singleControls(rec: Recruitment, bucket: Bucket, clock: number): ActionRow[] {
  const buttons: APIButtonComponent[] = [];
  if (nowHourIn(bucket, clock) !== null) {
    buttons.push(
      button(
        ButtonStyle.Success,
        "⚡ 今すぐ",
        encodeCustomId({ kind: "now", recruitmentId: rec.id, bucket: bucket.key }),
      ),
    );
  }
  for (const hour of openHours(bucket, clock)) {
    buttons.push(
      button(ButtonStyle.Primary, shortHourLabel(hour), encodeCustomId({ kind: "hour", recruitmentId: rec.id, hour })),
    );
  }
  return [...chunk(buttons, BUTTONS_PER_ROW), footerButtons(rec)].map((components) => ({
    type: ComponentType.ActionRow,
    components,
  }));
}

function anyControls(rec: Recruitment, clock: number): ActionRow[] {
  // 時刻がすべて過ぎた時間帯は選択肢が 0 個になり、Discord が盤面ごと受け付けないので出さない
  const selects: ActionRow[] = BUCKETS.flatMap((b) => {
    const open = openHours(b, clock);
    if (open.length === 0) return [];
    const options: APISelectMenuOption[] = [];
    if (nowHourIn(b, clock) !== null) options.push({ label: "⚡ 今すぐ", value: encodeSelectValue({ kind: "now" }) });
    for (const hour of open)
      options.push({ label: hourLabel(hour, rec.date), value: encodeSelectValue({ kind: "hour", hour }) });
    return [
      {
        type: ComponentType.ActionRow,
        components: [
          {
            type: ComponentType.StringSelect,
            custom_id: encodeCustomId({ kind: "select", recruitmentId: rec.id, bucket: b.key }),
            placeholder: `${b.emoji} ${b.label}なら何時から？`,
            options,
            min_values: 1,
            max_values: 1,
          },
        ],
      },
    ];
  });
  const buttons: APIButtonComponent[] = [
    button(ButtonStyle.Success, "🙆 いつでもOK", encodeCustomId({ kind: "anytime", recruitmentId: rec.id })),
    ...footerButtons(rec),
  ];
  return [...selects, { type: ComponentType.ActionRow, components: buttons }];
}
