# 一輝塾 出席管理システム

既存の家庭向けQRコードとログイン手順を引き継ぐ、出席予定の確認・取消・管理アプリです。React / TypeScript / Vite、Hono / Cloudflare Workers、D1 / SQLiteで構成しています。

## 現在の公開先

- [検証用ログイン](https://juku-attendance-system-staging.juku-matsuokakoki.workers.dev/login.html) — 架空の「山田」「佐藤」のデータのみ。パスワードは運用者に確認してください。
- [検証用先生メニュー](https://juku-attendance-system-staging.juku-matsuokakoki.workers.dev/teachertop_final.html)
- 本番用の新アプリはメンテナンス中です。旧Firebase Hosting・旧Firestoreへの本番切替は未実施です。

## 引き継ぐ運用

- 生徒は苗字と従来の共通パスワードでログイン。入力内容はサーバー側で検証します。
- 生徒は当日の出席を閲覧し、公開済みの今月〜再来月の予定を確認できます。登録済みの未来の予定だけ取消可能で、新規追加や保存済み取消の復活はできません。
- 先生は日本時間で1日1回、その日の最初に合言葉を入力します。セッションは翌日0時に失効します。
- 通常・臨時B・臨時C、休講・自習、定員表示、月次テンプレート、月単位の公開設定、生徒管理、読み・改名、お知らせ、過去閲覧、ログイン記録、従来形式のCSV出力に対応します。

この認証運用は強い本人確認ではありません。他人の苗字と共通パスワードを知る人のなりすましは防げません。先生権限との分離、API認可、CSRF対策、HttpOnly Cookie、入力検証とレート制限で影響範囲を制限します。

## ローカル開発

Node.js 24を使用します。クラウドの認証なしで架空データによる開発・検証ができます。

```sh
npm ci
npm run setup
npm run db:migrate
npm run db:seed
npm run build
npm run preview
```

`http://127.0.0.1:8787/login.html` を開いてください。`npm run setup` は未作成の場合だけランダムな開発用パスワードを `.dev.vars` に保存します。生徒名は「山田」「佐藤」です。このファイルはGit管理対象外です。

フロントエンドの更新中は、APIサーバーとViteを別ターミナルで起動します。

```sh
npm run dev:api
npm run dev
```

Viteの画面は `http://127.0.0.1:5173` です。ビルド済み画面を検証するときは、ビルド後に `preview` を起動し直してください。

## 検証

```sh
npm run typecheck
npm test
npm run build
npx playwright install chromium
npm run test:e2e
```

日付境界、日付移行、DB制約、取消の競合・再送、本人以外のアクセス拒否、CSRF、月の公開設定、月次生成、改名、CSV、実画面のログイン・取消操作・スマホ幅を検証します。GitHub Actionsでも同じ検証を実行します。

## 構成

- `src/`: 生徒・先生画面。先生機能は別チャンクとして読み込みます。
- `worker/`: 認証、認可、集約取得、更新API。
- `shared/`: 日本時間・日付、授業パターン、CSV、入力スキーマ。
- `migrations/`: DBスキーマ。予約の一意制約と外部キーを含みます。
- `scripts/`: ローカル準備、旧DB読取り、正規化、差分検出、切替設定の準備。
- `tests/` / `e2e/`: 単体・DB・操作テスト。
- `private/`: 実データ、照合結果、資格情報など。**Gitに追加しないでください。**

出席日は時刻を持たない `YYYY-MM-DD` で保存します。更新・ログイン時刻はUTCで保存します。人数は予約から集計するため、独立した人数データの修正は不要です。月次生成はDBバッチ内で置換し、先生・生徒の予定更新には月の更新番号を使って競合を検出します。

## 休講日の連携

```text
GET /public/v1/closures?from=2026-11-01&to=2026-11-30
```

実日付と公開用理由だけを返し、個人情報を含めません。ETagと短いキャッシュに対応します。公式サイトはこのAPIを読み込むことで休講日を同期できます。

## デプロイと移行

詳細は [運用・切替手順](docs/operations.md)、[技術選定](docs/architecture.md)、[検証記録](docs/verification.md) を参照してください。

Secretsは `STUDENT_PASSWORD`、`TEACHER_PASSWORD`、`SESSION_SECRET` です。Cloudflare Secretとして設定し、Gitや `wrangler.jsonc` に値を記載しません。本番は `MAINTENANCE=true` を既定にしています。

Firebase Hostingは配布済みリンクから新アプリへの302転送用に残します。転送後のアドレスバーは変わり、保存済みパスワードの自動入力には影響する場合があります。

無料プランの上限内で運用する設計です。上限超過時の停止や将来の料金変更まで防ぐものではありません。有料プランへの移行や有料サービスの追加は行っていません。
