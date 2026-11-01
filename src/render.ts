import {
  ButtonStyle,
  ComponentType,
  type APIActionRowComponent,
  type APIButtonComponent,
  type APIComponentInMessageActionRow,
  type APIEmbed,
  type APIInteractionResponseCallbackData,
  type APISelectMenuOption,
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
} from "./buckets.ts";
import { encodeCustomId, encodeSelectValue } from "./customId.ts";
import { formatDate } from "./date.ts";
import type { Recruitment } from "./recruitment.ts";
import {
  activeParticipants,
  recruitmentClock,
  tallyRecruitment,
  type Outcome,
  type Participant,
  type Ready,
  type Slot,
} from "./tally.ts";

type ActionRow = APIActionRowComponent<APIComponentInMessageActionRow>;

const BUTTONS_PER_ROW = 5;
const COLOR_ENDED = 0x99aab5;
const COLOR_READY = 0x57f287;
const COLOR_OPEN = 0x5865f2;

function mention(userId: string): string {
  return `<@${userId}>`;
}

function mentions(userIds: string[]): string {
  return userIds.map(mention).join(" ");
}

export function playersLabel(min: number, max: number | null): string {
  return max === null ? `${min}人〜` : `${min}人〜・定員${max}人`;
}

export function gameLabel(game: { name: string; min: number; max: number | null }): string {
  return `${game.name}（${playersLabel(game.min, game.max)}）`;
}

function button(style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger, label: string, customId: string): APIButtonComponent {
  return { type: ComponentType.Button, style, label, custom_id: customId };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function renderBoard(rec: Recruitment, participants: Participant[], now: Date): APIInteractionResponseCallbackData {
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

  const lines = [`募集: ${mention(rec.hostId)}（${playersLabel(rec.min, rec.max)}）`, "", ...rows, ""];
  lines.push(...outcomeLines(rec, t.outcome));
  if (t.passed.length > 0) lines.push(`パス: ${mentions(t.passed)}`);
  if (ended) lines.push("", rec.status === "cancelled" ? "この募集は中止されました" : "この募集は締め切られました");

  const when = scope === "any" ? "いつでも" : `${bucketOf(scope).emoji}${bucketOf(scope).label}`;
  const badge = rec.status === "closed" ? " ［締め切り］" : rec.status === "cancelled" ? " ［中止］" : "";
  const embed: APIEmbed = {
    title: `🎮 ${rec.game} やる人？ ${formatDate(rec.date)} ${when}${badge}`,
    description: lines.join("\n"),
    color: ended ? COLOR_ENDED : t.outcome.kind === "ready" ? COLOR_READY : COLOR_OPEN,
  };

  const components =
    clock === null ? [] : scope === "any" ? anyControls(rec, clock) : singleControls(rec, bucketOf(scope), clock);

  // 一覧のメンションは名前表示のためだけに使う。押すたびに全員へ通知が飛ばないよう抑止する
  return { embeds: [embed], components, allowed_mentions: { parse: [] } };
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
    button(ButtonStyle.Secondary, "今日はパス", encodeCustomId({ kind: "pass", recruitmentId: rec.id })),
    button(ButtonStyle.Secondary, "⚙", encodeCustomId({ kind: "gear", recruitmentId: rec.id })),
  ];
}

function singleControls(rec: Recruitment, bucket: Bucket, clock: number): ActionRow[] {
  const buttons: APIButtonComponent[] = [];
  if (nowHourIn(bucket, clock) !== null) {
    buttons.push(button(ButtonStyle.Success, "⚡ 今すぐ", encodeCustomId({ kind: "now", recruitmentId: rec.id, bucket: bucket.key })));
  }
  for (const hour of openHours(bucket, clock)) {
    buttons.push(button(ButtonStyle.Primary, shortHourLabel(hour), encodeCustomId({ kind: "hour", recruitmentId: rec.id, hour })));
  }
  return [...chunk(buttons, BUTTONS_PER_ROW), footerButtons(rec)].map((components) => ({
    type: ComponentType.ActionRow,
    components,
  }));
}

function anyControls(rec: Recruitment, clock: number): ActionRow[] {
  const selects: ActionRow[] = BUCKETS.map((b) => {
    const open = openHours(b, clock);
    const options: APISelectMenuOption[] = [];
    if (nowHourIn(b, clock) !== null) options.push({ label: "⚡ 今すぐ", value: encodeSelectValue({ kind: "now" }) });
    for (const hour of open) options.push({ label: hourLabel(hour, rec.date), value: encodeSelectValue({ kind: "hour", hour }) });
    options.push({ label: `${b.label}は無理`, value: encodeSelectValue({ kind: "none" }) });
    return {
      type: ComponentType.ActionRow,
      components: [
        {
          type: ComponentType.StringSelect,
          custom_id: encodeCustomId({ kind: "select", recruitmentId: rec.id, bucket: b.key }),
          placeholder: `${b.emoji} ${b.label}なら何時から？${open.length === 0 ? "（終了）" : ""}`,
          options,
          min_values: 1,
          max_values: 1,
          disabled: open.length === 0,
        },
      ],
    };
  });
  const buttons: APIButtonComponent[] = [
    button(ButtonStyle.Success, "🙆 いつでもOK", encodeCustomId({ kind: "anytime", recruitmentId: rec.id })),
    ...footerButtons(rec),
  ];
  return [...selects, { type: ComponentType.ActionRow, components: buttons }];
}

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
