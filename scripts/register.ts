import { commands } from "../src/discord/commands.ts";

const { DISCORD_APP_ID, DISCORD_GUILD_ID, DISCORD_BOT_TOKEN } = process.env;
if (!DISCORD_APP_ID || !DISCORD_GUILD_ID || !DISCORD_BOT_TOKEN) {
  console.error(".dev.vars に DISCORD_APP_ID / DISCORD_GUILD_ID / DISCORD_BOT_TOKEN を設定してください");
  process.exit(1);
}

// グローバルコマンドは反映に時間がかかるため、1 サーバー専用のギルドコマンドとして登録する
const res = await fetch(
  `https://discord.com/api/v10/applications/${DISCORD_APP_ID}/guilds/${DISCORD_GUILD_ID}/commands`,
  {
    method: "PUT",
    headers: { Authorization: `Bot ${DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(commands),
  },
);
if (!res.ok) {
  console.error(`コマンドの登録に失敗しました: ${res.status} ${await res.text()}`);
  process.exit(1);
}
console.log(`${commands.length} 個のコマンドを登録しました`);
