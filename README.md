# game-bot

ゲームの参加者を募集し、参加できる開始時刻を集める Discord bot。Cloudflare Workers と D1 で動く。

## 使い方

| コマンド | 内容 |
|---|---|
| `/game add name:Apex players:3 max:3 role:@Apex勢` | ゲームと最少人数を登録する。`max` は定員で、省略すると定員なし。`role` はこのゲームの募集でメンションするロールで、省略するとメンションしない。登録済みなら上書き |
| `/game list` | 登録済みのゲームを表示する（自分にだけ見える） |
| `/game remove name:Apex` | ゲームの登録を消す |
| `/募集 game:Apex` | 今日の募集を出す。`時間帯:夜` で時間帯を、`date:11/3` や `date:明日` で日付を、`通知:@Apex勢` でメンションするロールを指定できる |
| `/使い方` | この bot の使い方を表示する（自分にだけ見える） |

### 時間帯

| 時間帯 | 時刻 |
|---|---|
| 🌅 朝 | 6〜11 時 |
| ☀️ 昼 | 12〜17 時 |
| 🌙 夜 | 18〜23 時 |
| 🌌 深夜 | 翌 0〜5 時 |
| いつでも | 上の 4 つすべて |

- 時間帯を省略すると、今日の募集なら今の時間帯を選ぶ。今の時間帯に残っている時刻が 3 つ未満なら次の時間帯にする。深夜の残りも 3 つ未満なら翌日の朝の募集になる。今日以外の日付なら夜になる
- 指定した時間帯の時刻がすべて過ぎていれば、募集は出さずに実行した人にだけ知らせる
- 0〜5 時は前日の深夜として扱う。この時間に日付を省略したり「今日」と書いたりすると前日の募集になり、「明日」はその翌日になる
- 募集した人は自動で参加する。時間帯を指定した募集なら最初に残っている時刻から、いつでもの募集なら「いつでもOK」で参加する

### 回答

- 時間帯を 1 つ指定した募集では、時刻のボタンを押すとその時刻から参加する扱いになる。押し直すと上書きされる。過ぎた時刻のボタンは出ない
- いつでもの募集では、時間帯ごとのメニューで開始時刻を選ぶ。時間帯ごとに別々に回答でき、「朝は無理」などを選ぶとその時間帯の回答を消す。「🙆 いつでもOK」はすべての時間帯・時刻で参加する扱いになり、押すたびにオンとオフが切り替わる
- 今がその時間帯の中なら「⚡ 今すぐ」を選べる。今の時刻から参加する扱いになり、一覧に ⚡今すぐ と付く
- 「今日はパス」を押すと、その人の回答をすべて消してパスにする

### 集計と通知

- 早い時刻から参加できる人は、同じ時間帯の中でそれより後の時刻の人数にも数える。時間帯をまたいでは数えない
- 最少人数がそろった最初の時刻で、そろったメンバーに 1 回だけメンションする
- 定員を超えたら、先に回答した人から定員までをメンバーにし、残りを補欠として表示する
- 受付中は過ぎた時刻を数えない。締め切り・中止の後は、通知した時刻に今も最少人数がいればその結果を残し、それ以外は「そろいませんでした」と出す

### ロールへのメンション

- 募集を出すとき、`通知` で指定したロールに、なければ `/game add` で登録したロールにメンションする。どちらもなければメンションしない
- メンションは募集を出したときの 1 回だけ届く
- bot には全ロールへのメンション権限を付けていないので、メンションするロールはサーバー設定の「ロール」で「このロールに対して@mentionを許可する」をオンにしておく

### 締め切りと中止

- 募集の ⚙ を押すと、募集した人にだけ「締め切る」と「中止」が出る。ほかの人が押すと、募集した人だけが操作できると本人にだけ返す
- 締め切るとボタンが消え、結果だけが残る。bot の権限が足りず投稿を書き換えられなかったときは、そのことを募集した人にだけ知らせる。中止すると、パスした人と募集した人を除いて回答していた人にメンションで知らせる
- 募集の時間帯の時刻がすべて過ぎると、毎時の定期処理が自動で締め切る

## セットアップ

### 1. 依存を入れる

```powershell
npm install
```

### 2. Discord のアプリを作る

1. [Discord Developer Portal](https://discord.com/developers/applications) で New Application を押してアプリを作る
2. General Information で `APPLICATION ID` と `PUBLIC KEY` を控える
3. Bot タブで Reset Token を押し、token を控える（他人に見せない）
4. Installation タブで Guild Install だけを有効にし、Default Install Settings の scopes に `applications.commands` と `bot` を入れ、Permissions に `View Channel` と `Send Messages` を入れる（締め切り・中止で投稿を書き換えたり中止を知らせたりするのに使う）
5. 同じ画面の Install Link をブラウザで開き、対象のサーバーに追加する
6. Discord の設定 → 詳細設定 → 開発者モードを ON にし、サーバー名を右クリック →「サーバー ID をコピー」で ID を控える

### 3. Cloudflare にデプロイする

```powershell
npx wrangler login
npx wrangler d1 create game-bot
```

表示された `database_id` と、手順 2 の `APPLICATION ID`・`PUBLIC KEY` を `wrangler.jsonc` の `REPLACE_WITH_...` に書き込む。

bot token を Worker の secret に登録する。

```powershell
npx wrangler secret put DISCORD_BOT_TOKEN
```

```powershell
npm run migrate
npm run deploy
```

募集を自動で締め切る毎時の定期処理（Cron）は `wrangler.jsonc` の `triggers` に書いてあり、デプロイすると有効になる。

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
