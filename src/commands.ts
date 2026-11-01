import { ApplicationCommandOptionType, type RESTPutAPIApplicationGuildCommandsJSONBody } from "discord-api-types/v10";

export const RECRUIT_COMMAND = "募集";
export const GAME_COMMAND = "game";
export const SCOPE_OPTION = "時間帯";

export const commands: RESTPutAPIApplicationGuildCommandsJSONBody = [
  {
    name: GAME_COMMAND,
    description: "募集に使うゲームを管理する",
    options: [
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "add",
        description: "ゲームを登録する（登録済みなら人数を上書き）",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "name",
            description: "ゲーム名",
            required: true,
            max_length: 50,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "players",
            description: "最少人数",
            required: true,
            min_value: 1,
            max_value: 99,
          },
          {
            type: ApplicationCommandOptionType.Integer,
            name: "max",
            description: "定員。省略すると定員なし",
            min_value: 1,
            max_value: 99,
          },
        ],
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "list",
        description: "登録済みのゲームを表示する",
      },
      {
        type: ApplicationCommandOptionType.Subcommand,
        name: "remove",
        description: "ゲームの登録を消す",
        options: [
          {
            type: ApplicationCommandOptionType.String,
            name: "name",
            description: "ゲーム名",
            required: true,
            autocomplete: true,
          },
        ],
      },
    ],
  },
  {
    name: RECRUIT_COMMAND,
    description: "ゲームの参加者を募集する",
    options: [
      {
        type: ApplicationCommandOptionType.String,
        name: "game",
        description: "ゲーム名（/game add で登録したもの）",
        required: true,
        autocomplete: true,
      },
      {
        type: ApplicationCommandOptionType.String,
        name: SCOPE_OPTION,
        description: "時間帯。省略すると今日なら今の時刻から決め、ほかの日は夜",
        choices: [
          { name: "いつでも", value: "any" },
          { name: "朝", value: "morning" },
          { name: "昼", value: "noon" },
          { name: "夜", value: "night" },
          { name: "深夜", value: "late" },
        ],
      },
      {
        type: ApplicationCommandOptionType.String,
        name: "date",
        description: "日付（例: 11/3、明日）。省略すると今日（0〜5時は前日の深夜扱い）",
      },
    ],
  },
];
