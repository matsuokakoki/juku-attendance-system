# 運用と切替

## 現在の状態

2026-10-28時点で、旧Firestoreからの初回抽出・正規化と、新設D1への初回移行を実施しました。旧システムは継続稼働中です。切替日時は未定です。

- 検証Worker: `juku-attendance-system-staging`、DBは架空データ。
- 本番Worker: `juku-attendance-system`、初回移行済みDBに接続。`MAINTENANCE=true`。
- Firebase: `juku-attendance`。旧Hostingと旧Rulesはまだ変更していません。
- 本番の先生用合言葉はCloudflare Secretへ設定。日本時間の翌日0時で認証期限が切れます。

## 旧データの抽出と差分

`npm run export:legacy` はGoogleのApplication Default Credentialsを用いる読取り専用スクリプトです。認証済みのFirebaseプラグインで十分な読取手段がない場合は、ローカルの公式SDKから実行します。管理用資格情報はGitへ置きません。

```sh
npm run export:legacy
node scripts/normalize.mjs private/firestore-snapshot-TIMESTAMP.json YYYY-MM-DD
node scripts/compare-snapshots.mjs private/初回.json private/最終.json YYYY-MM-DD
```

`YYYY-MM-DD` は保持対象の開始日です。初回は2026-07-28以降の予約と将来予定を対象としました。正規化されたSQLとJSONは `private/` に出力されます。

日付は保存元ごとに変換し、予約・休講日・臨時日については+1日した日付と親の月が一致することを検証します。不一致は処理を停止します。テンプレートは曜日データなので日付補正しません。旧ログイン記録には正確な時刻がないため、元の日付を維持し、日本時間正午の仮時刻で移しています。実時刻として分析しないでください。

SQL出力は移行対象の全量置換用です。削除された予約も反映します。適用はアプリを停止し、バックアップを取得し、対象DBを確認してから行います。本番での更新再開後には、そのまま適用しないでください。空のサイト本文は既存値を置き換えません。

## 本番切替の約1時間

事前に同じ手順を検証用DBでリハーサルし、実測が1時間枠内であることを確認します。

1. 旧Hostingの設定とRules、旧Firestore、新D1をバックアップする。
2. 旧利用者にメンテ画面を表示し、旧Firestoreの一般利用者の読み書きを停止する。開いたままの古いタブからの書込みも拒否する。管理者の抽出は引き続き可能。
3. 旧Firestoreを最終抽出し、初回との差分と正規化結果を確認する。
4. メンテ中の新D1へ最終データを適用する。追加・変更・削除すべてを照合する。
5. 生徒別・日付別・コマ別の予約集合、名簿、通常/B/C、休講、テンプレート、公開月を照合する。旧人数と一致しない場合は予約からの人数を採用する。
6. 実機で苗字と従来パスワード、先生の合言葉、取消、月初月末、CSVを検証する。
7. Firebase Hostingの各旧URLを対応する新画面へ302転送する。確認後に新アプリのメンテを解除する。
8. 少なくとも初回の月次生成まで、エラーとD1使用量を確認する。

転送用の設定は次のコマンドで準備できます。**このコマンドだけではデプロイされません。**

```sh
node scripts/prepare-cutover.mjs https://juku-attendance-system.ikki-juku.workers.dev
```

`private/cutover/` にHosting設定と旧DB停止用Rulesを出力します。保存した旧設定と組み合わせ、Firebaseプラグインまたは公式CLIで適用します。書込み停止をHosting切替だけで代用しないでください。

## 復旧

- 書込み再開前: 新アプリをメンテのままにし、旧Hostingと旧Rulesを保存版へ戻す。
- 書込み再開後: 新システムの変更を無視して旧DBへ戻さない。メンテを再開してバックアップし、原則は新システムを修正して復旧する。
- 逆移行が必要なら、新DBの最新全量から旧形式を復元し、旧DBとの差分を照合する。逆移行スクリプトは現時点で未実装・未検証なので、自動で戻せると判断しない。
- WorkerのロールバックはDBの復旧とは別。D1のTime TravelはFreeで7日分。外部に保存したSQLバックアップからの復元も検証してから運用する。

## 継続開発

コード・設定・SQLマイグレーションをGitに残し、検証用環境でテストします。MCP上で変更したスキーマだけを残さないでください。D1のマイグレーション履歴も管理します。CLIでのクラウド操作には初回の認証が必要です。通常はCloudflare・Firebase・GitHubプラグインで操作でき、不足する機能だけ公式CLIを使います。

本番へのデプロイは `npm run deploy:production`、検証用は `npm run deploy`。本番メンテ解除は、上記の最終移行と照合が完了してから設定を明示的に変更します。通常のデプロイで勝手に解除しません。
