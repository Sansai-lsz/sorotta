# game-bot

ゲームの参加者を募集し、参加できる開始時刻を集める Discord bot。Cloudflare Workers と D1 で動く。

## 使い方

| コマンド | 内容 |
|---|---|
| `/game add name:Apex players:3` | ゲームと必要人数を登録する。登録済みなら人数を上書き |
| `/game list` | 登録済みのゲームを表示する（自分にだけ見える） |
| `/game remove name:Apex` | ゲームの登録を消す |
| `/募集 game:Apex` | 今日の募集を出す。`date:11/3` や `date:明日` で日付を指定できる |

- 募集の投稿にある `20時〜` から `24時〜` のボタンを押すと、その時刻から参加する扱いになる。押し直すと上書きされる
- 早い時刻から参加できる人は、それより後の時刻の人数にも数える
- 必要人数がそろった最初の時刻で、そろったメンバーに 1 回だけメンションする
- ボタンの時刻は `src/tally.ts` の `HOURS` で変えられる

## セットアップ

### 1. 依存を入れる

```powershell
npm install
```

### 2. Discord のアプリを作る

1. [Discord Developer Portal](https://discord.com/developers/applications) で New Application を押してアプリを作る
2. General Information で `APPLICATION ID` と `PUBLIC KEY` を控える
3. Bot タブで Reset Token を押し、token を控える（他人に見せない）
4. Installation タブで Guild Install だけを有効にし、Default Install Settings の scopes に `applications.commands` と `bot` を入れる（Permissions は不要）
5. 同じ画面の Install Link をブラウザで開き、対象のサーバーに追加する
6. Discord の設定 → 詳細設定 → 開発者モードを ON にし、サーバー名を右クリック →「サーバー ID をコピー」で ID を控える

### 3. Cloudflare にデプロイする

```powershell
npx wrangler login
npx wrangler d1 create game-bot
```

表示された `database_id` と、手順 2 の `APPLICATION ID`・`PUBLIC KEY` を `wrangler.jsonc` の `REPLACE_WITH_...` に書き込む。

```powershell
npm run migrate
npm run deploy
```

デプロイ後に表示される `https://game-bot.<アカウント名>.workers.dev` を、Developer Portal の General Information → Interactions Endpoint URL に貼って保存する。保存時に Discord が署名の検証を試すので、ここで保存できればつながっている。

### 4. コマンドを登録する

```powershell
Copy-Item .dev.vars.example .dev.vars
```

`.dev.vars` に Application ID、サーバー ID、bot token を書き、登録する。

```powershell
npm run register
```

コマンドを変えたときも `npm run register` を再実行する。

## 開発

```powershell
npm run typecheck
npm test
```

`npm run dev` には workerd が必要。npm の設定で install script が止められている場合は、`npm install-scripts approve workerd` と `npm rebuild workerd` を先に実行する。

`wrangler.jsonc` を変えたら `npm run types` で `worker-configuration.d.ts` を作り直す。
