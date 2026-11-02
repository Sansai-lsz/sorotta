export const EVERYONE_ROLE_REFUSAL = "@everyone は指定できません。知らせたい人だけに付けたロールを選んでください";
export const UNMENTIONABLE_WARNING =
  "このロールは「このロールに対して@mentionを許可する」がオフなので、メンションが届きません。サーバー設定のロールでオンにしてください";

export type RoleCheck = { ok: true; warning: string | null } | { ok: false; message: string };

// @everyone ロールの ID はサーバーの ID と同じ。bot には全員へのメンション権限を付けていないので断る
export function checkNotifyRole(roleId: string, guildId: string, mentionable: boolean | undefined): RoleCheck {
  if (roleId === guildId) return { ok: false, message: EVERYONE_ROLE_REFUSAL };
  return { ok: true, warning: mentionable === false ? UNMENTIONABLE_WARNING : null };
}

export function chooseNotifyRole(option: string | undefined, gameDefault: string | null): string | null {
  return option ?? gameDefault;
}
