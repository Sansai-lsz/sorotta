# そろった（sorotta）

<img src="assets/icon.png" alt="そろった のアイコン" width="96" align="right">

ゲームの参加者と開始時刻をボタンで集め、人数がそろったらメンバーに知らせる Discord bot。1 つのサーバーに入れて使う前提で作っている。

Cloudflare Workers と D1 で動き、無料枠の範囲で常時稼働する。

## 使い方

| コマンド | 内容 |
|---|---|
| `/募集 game:Apex` | 募集を出す。`時間帯:夜` で時間帯を、`date:11/3` や `date:明日` で日付を、`通知:@Apex勢` でメンションするロールを指定できる |
| `/game add name:Apex players:3 max:3 role:@Apex勢` | ゲームを登録する。`players` は最少人数、`max` は定員（省略すると定員なし）、`role` はこのゲームの募集でメンションするロール（省略するとメンションしない）。登録済みのゲームなら全項目を上書きする |
| `/game list` | 登録済みのゲームを表示する（実行した人にだけ見える） |
| `/game remove name:Apex` | ゲームの登録を消す |
| `/使い方` | この bot の使い方を表示する（実行した人にだけ見える） |

募集できるのは `/game add` で登録したゲームだけ。

### 時間帯

| 時間帯 | 時刻 |
|---|---|
| 🌅 朝 | 6〜11 時 |
| ☀️ 昼 | 12〜17 時 |
| 🌙 夜 | 18〜23 時 |
| 🌌 深夜 | 翌 0〜5 時 |
| いつでも | 上の 4 つすべて |

- 時間帯を省略したときは、今日の募集なら今の時間帯を使う。今の時間帯に残っている時刻が 3 つ未満なら次の時間帯にし、深夜の残りも 3 つ未満なら翌日の朝にする。今日以外の日付なら夜にする
- 指定した時間帯の時刻がすべて過ぎていれば、募集を出さずに、実行した人にだけその旨を返す
- 0〜5 時は前日の深夜として扱う。この時間帯に日付を省略するか「今日」と書くと前日の募集になり、「明日」はその翌日になる
- 募集した人は自動で参加する。時間帯を 1 つ指定した募集では最初に残っている時刻から、いつでもの募集では「いつでもOK」で参加する

### 回答のしかた

- 時間帯を 1 つ指定した募集では、時刻のボタンを押すと、その時刻から参加する扱いになる。過ぎた時刻のボタンは出ない
- いつでもの募集では時間帯ごとのメニューで開始時刻を選ぶ。時間帯ごとに別々に答えられ、「朝は無理」などを選ぶとその時間帯の回答を消す
- 「🙆 いつでもOK」はすべての時間帯と時刻で参加する扱いになる。押すたびにオンとオフが切り替わる
- 今がその時間帯の中なら「⚡ 今すぐ」を選べる。今の時刻から参加する扱いになり、一覧に ⚡今すぐ と付く
- 「今日はパス」を押すと、その人の回答をすべて消してパスにする
- 時刻を選び直すと、前の回答を上書きする

### 集計と通知

- 早い時刻から参加できる人を、同じ時間帯の中でそれより後の時刻の人数にも数える。時間帯をまたいでは数えない
- 最少人数がそろった最初の時刻で、そろったメンバーに 1 回だけメンションする
- 定員を超えたら、先に回答した人から定員までをメンバーにし、残りを補欠として表示する
- 受付中は過ぎた時刻を数えない。締め切りや中止のあとは、通知した時刻に今も最少人数がいればその結果を残し、いなければ「そろいませんでした」と表示する

### ロールへのメンション

- 募集を出すとき、`通知` で指定したロールにメンションする。指定がなければ `/game add` で登録したロールに、どちらもなければメンションしない
- メンションが届くのは、募集を出したときの 1 回だけ
- @everyone は指定できない
- bot には全ロールへのメンション権限を付けていない。そのため、メンションするロールではサーバー設定の「ロール」で「このロールに対して@mentionを許可する」をオンにしておく。オフのロールを指定すると、メンションが届かないことを返信で注意する

### 締め切りと中止

- 募集の ⚙ を押すと、募集した人にだけ「締め切る」と「中止」が出る。ほかの人が押すと、募集した人だけが操作できることを本人にだけ返す
- 締め切ると、ボタンが消えて結果だけが残る
- 中止すると、パスした人と募集した人を除き、回答していた人にメンションで知らせる
- bot の権限が足りず投稿を書き換えられなかったときは、募集した人にだけそのことを知らせる
- 時間帯の時刻がすべて過ぎた募集は、毎時の定期処理が自動で締め切る

## 仕組み

- Discord からの操作は Cloudflare Workers に HTTP で届く（Interactions Endpoint）。Discord に常時接続しないので、bot はメンバー一覧で常にオフライン表示になる
- 募集と回答は D1（SQLite）に保存する
- 自動の締め切りは Workers の Cron で毎時 0 分に動く
- 募集の投稿の書き換えと中止の通知には、bot token を使う

## セットアップ

自分のサーバーで動かすときの手順。コマンドは PowerShell の例。

### 1. 依存を入れる

パッケージマネージャには pnpm を使う。入っていなければ npm で入れる。このリポジトリの中では `package.json` の `packageManager` の版に切り替わる。

```powershell
npm install -g pnpm@latest
pnpm install
```

### 2. Discord のアプリを作る

1. [Discord Developer Portal](https://discord.com/developers/applications) で New Application を押し、アプリを作る
2. General Information で `APPLICATION ID` と `PUBLIC KEY` を控える
3. Bot タブで Reset Token を押し、token を控える。token は他人に見せない
4. Installation タブで、Installation Contexts の Guild Install だけを有効にする。Default Install Settings の Scopes に `applications.commands` と `bot` を、Permissions に `View Channel` と `Send Messages` を入れる
5. Install Link をブラウザで開き、サーバーに追加する（サーバー管理の権限が必要）
6. Discord の設定 → 詳細設定で開発者モードをオンにし、サーバー名を右クリック →「サーバー ID をコピー」で ID を控える

### 3. 設定を書き換える

```powershell
pnpm exec wrangler login
pnpm exec wrangler d1 create game-bot
```

`wrangler.jsonc` の次の値を、自分のものに書き換える。

| キー | 値 |
|---|---|
| `d1_databases[0].database_id` | `wrangler d1 create` が表示した ID |
| `vars.DISCORD_APP_ID` | 手順 2 の `APPLICATION ID` |
| `vars.DISCORD_PUBLIC_KEY` | 手順 2 の `PUBLIC KEY` |

コマンドの登録に使う値を `.dev.vars` に書く。`.dev.vars` は git の管理対象外。

```powershell
Copy-Item .dev.vars.example .dev.vars
notepad .dev.vars
```

| キー | 値 |
|---|---|
| `DISCORD_APP_ID` | 手順 2 の `APPLICATION ID` |
| `DISCORD_GUILD_ID` | 手順 2 のサーバー ID |
| `DISCORD_BOT_TOKEN` | 手順 2 の token |

### 4. デプロイする

先にデータベースを作る。

```powershell
pnpm run migrate
```

`wrangler.jsonc` で bot token を必須の secret にしているので、初回のデプロイでは token を一緒に渡す。まだない Worker には `wrangler secret put` で secret を登録できないため、token だけを書いた一時ファイルを使う。

```powershell
Select-String -Path .dev.vars -Pattern '^DISCORD_BOT_TOKEN=' | ForEach-Object { $_.Line } | Set-Content -Path secrets.tmp
pnpm exec wrangler deploy --secrets-file secrets.tmp
Remove-Item secrets.tmp
```

2 回目からは `pnpm run deploy` だけでよい。token を変えたときは `pnpm exec wrangler secret put DISCORD_BOT_TOKEN` で登録し直す。

デプロイすると `https://sorotta.<サブドメイン>.workers.dev` が表示される。この URL を Developer Portal の General Information → Interactions Endpoint URL に貼って保存する。保存するときに Discord が署名を検証するので、保存できればつながっている。

### 5. コマンドを登録する

```powershell
pnpm run register
```

コマンドは `.dev.vars` の `DISCORD_GUILD_ID` のサーバーにだけ登録する（ギルドコマンド）。コマンドやオプションを変えたときは、もう一度実行する。

### 更新するとき

`migrations/` に新しいファイルが増えたときは、デプロイより先に `pnpm run migrate` を実行する。新しいコードがまだない列を読んで失敗するのを防ぐため。

```powershell
pnpm run migrate
pnpm run deploy
pnpm run register
```

## 開発

```powershell
pnpm run fmt
pnpm run typecheck
pnpm test
```

- PR と main への push では、GitHub Actions が整形・型検査・テスト・バンドルを確かめる
- 依存の install script は、`pnpm-workspace.yaml` の `allowBuilds` で許可した esbuild と workerd のものだけが動く。install script を持つ依存が新しく増えると `pnpm install` が失敗するので、中身を確かめてから `allowBuilds` に足す
- 公開から 1 日たっていない版は入らない（`minimumReleaseAge`）。公開時の信頼レベルが前の版より下がった版も入らない（`trustPolicy`）
- `wrangler.jsonc` を変えたら、`pnpm run types` で `worker-configuration.d.ts` を作り直す
- 画面の動きを確かめるためのモックが `docs/mock.html` にある

## ライセンス

[MIT](LICENSE)
