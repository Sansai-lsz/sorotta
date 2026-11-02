import { ButtonStyle, ComponentType, type APIButtonComponent } from "discord-api-types/v10";

export function mention(userId: string): string {
  return `<@${userId}>`;
}

export function mentions(userIds: string[]): string {
  return userIds.map(mention).join(" ");
}

export function button(
  style: ButtonStyle.Primary | ButtonStyle.Secondary | ButtonStyle.Success | ButtonStyle.Danger,
  label: string,
  customId: string,
): APIButtonComponent {
  return { type: ComponentType.Button, style, label, custom_id: customId };
}
