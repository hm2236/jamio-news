# JAMIO NEWS / じゃみお新聞

じゃみお向け個人ニュースサイト。毎日の「じゃみお朝刊」をMarkdownで蓄積し、GitHub Pagesで静的配信します。

- トップ：3分で読むトップ5、今日のいちき串木野の天気、一面、重要セール。
- AI / テック、PC・半導体、VR機器・VRChat（VRC）、価格ウォッチ / セール、鹿児島・いちき串木野、経済・生活、過去号、注目テーマ。
- スマホ対応、システム連動＋手動ダークモード、本文検索、タグ、RSS。
- 確認済み事実 / 報道 / 未確認情報の表示。出典・検証メモ・訂正履歴。
- 価格履歴：現在の観測価格、30日前比、観測最安、買い判断。

**初期コンテンツは2026-10-04の開設号（編集ガイド）です。最新ニュースや実売価格は未収集。自動収集・朝刊のチャット配信は未有効化です。** 天気だけは閲覧時に外部APIから取得します。

## ローカルで確認

Node.js 22以上。外部パッケージのインストールは不要です。

```sh
node --test
node scripts/validate.mjs
node scripts/build.mjs
node scripts/serve.mjs
```

プレビュー：http://127.0.0.1:4173/jamio-news/

## 記事を追加

`content/articles/` に記事、`content/editions/` に日付別の朝刊を追加します。標準的なMarkdownの先頭に、`---`で囲んだJSONメタデータを置きます（JSONはYAMLのサブセット）。見出し、段落、箇条書き、番号リスト、太字、リンク、引用、インラインコード、コードブロックに対応。生HTML・画像・表・入れ子リストは本文レンダラーの対象外です。価格表は構造化データから生成します。

```sh
node scripts/new-edition.mjs 2026-10-05
```

`drafts/2026-10-05/` に空の朝刊、`articles/`、空の観測配列 `prices.json` を生成します。草稿は公開対象外・Git管理対象外です。日付付きslugで実際に確認した記事を作成し、朝刊の参照と `production` メタデータを埋めます。未完成の草稿は検証に失敗します。

```sh
node scripts/daily.mjs check drafts/2026-10-05
node scripts/daily.mjs apply drafts/2026-10-05
node scripts/validate.mjs
node --test
node scripts/build.mjs
```

`check` は無変更、`apply` は全件検証後に記事・号を追加し価格を追記します。既存の同日号と一致する再実行は `unchanged`、相違があれば停止します。出力はJSONで、`applied` はローカル反映のみです。PRを公開・CI確認・マージ後、mainを取得して `node scripts/daily.mjs confirm YYYY-MM-DD <マージ後mainの40桁SHA>` を実行し、`published` と `editionUrl` が返って初めて公開完了です。

**機械可読契約**：[contracts/publishing.schema.json](contracts/publishing.schema.json)。必須項目、独自format、参照・出典の追加検証、[06:00制作開始・07:00公開目標の引き継ぎ](docs/morning-pipeline.md)、[実行プロンプト](docs/chatgpt-morning-prompt.md)をセットで使用してください。日刊号はビルド・CIでも同じ契約を検証します。

**remote/scheduled**：予定タスクにWeb＋GitHub APIがあり、clone/Nodeが使えない場合は自動的にこのモードを選択します。`daily/YYYY-MM-DD` だけに最終記事・号と実価格観測をAPIで書き、信頼済みmainの **Daily publication guard** と、正確なPR headの **Publish JAMIO NEWS** が成功してから期待head SHA付きでマージ。mainのPages成功と公開receiptのSHA/date/URL/digestをAPI/Webで照合すれば、ローカル実行は不要です。日刊PRはコード・契約・CI・既存記事を変更できず、価格履歴は追記だけです。[詳細なAPI手順](docs/morning-pipeline.md#remotescheduledのapi手順)。

記事メタデータ例：

```json
{
  "title": "記事タイトル",
  "summary": "じゃみおへの影響を1〜2文で",
  "category": "ai",
  "tags": ["OpenAI", "AIコーディング"],
  "status": "verified",
  "kind": "news",
  "published": "2026-10-05T08:00:00+09:00",
  "verificationNote": "一次資料で機能の公開を確認。性能の一般化は未確認。",
  "sources": [
    {"title": "発表本体", "type": "official", "url": "https://example.com/announcement", "checked": "2026-10-05T07:30:00+09:00"}
  ]
}
```

例示URLをそのまま本番記事に使わず、読んだ実際の出典に置き換えてください。

- カテゴリキー：`ai`, `hardware`, `vr`, `deals`, `local`, `life`。VR機器・VRChat（VRC）は `vr` に分類します。
- 確認状態：`verified`, `reported`, `unconfirmed`。開設ガイドは `kind: guide`, `status: editorial`。
- 出典種別：`official`, `paper`, `github`, `blog`, `media`, `x`。
- `verified`はX以外の一次資料必須、`reported`は報道出典必須、Xがあれば`verificationNote`必須。
- 朝刊：`top5`（5件）、`hero`、`articles`（全記事）、`deals`（その号の重要セール）を記事slugで参照。
- 日刊記事のslugは `YYYY-MM-DD-<slug>`、本文と `verificationNote` は必須。出典の `checked` も実際のJST確認時刻です。朝刊には `production: {"contractVersion": 1, "x": {"status": "unavailable", "note": "実際の取得不可理由・代替出典の説明"}}` など、実際のX利用状況を記録します。出典URLの例示ドメインは日刊契約で拒否します。
- 訂正時は`updated`、`corrections`を記載。既存号を消さず、出典と訂正履歴を残します。

検証はメタデータの抜けや矛盾を止めるもので、記事の主張を自動的に事実確認するものではありません。編集者が原典と主張を照合する必要があります。

## VR機器・VRChat（VRC）の追跡

正式な追跡対象は、Meta Quest・PC VR、SteamVR / OpenXR、Valve・Meta・HTC・PICO・Bigscreen、アイトラッキング・フェイストラッキング・ハンドトラッキング・フルトラ、無線化、GPU要件、価格・在庫です。VRChat本体・SDK・Creator Economy・Trust & Safety、アバター / ワールド制作、イベント・コミュニティへの影響も扱います。

買い替える価値、必要スペックの変化、VRC体験への効果、日本での価格・発売時期まで確認します。掲載と検証は[編集方針](docs/editorial-policy.md)に従い、カテゴリ・注目テーマは `site.config.json` で管理します。

## 価格履歴

`data/prices.json` に観測行を追加します。商品名`product`、型番`sku`、店舗`shop`、条件`condition`、通貨`currency: JPY`、税込送料込`total`、出典`url`、JST観測日時`observed`、判定`verdict`（`buy`, `conditional`, `wait`）、理由`reason`を保存。30日前比は同じSKU・店舗・条件で、30日前以前の最も近い7日以内の記録を使います。データ不足なら変化率を表示しません。

## 公開

このリポジトリは公開リポジトリです。GitHub Pagesも公開サイトです。秘密鍵・認証情報・個人的な非公開情報は保存しません。

GitHub Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定します。`main`への更新でテスト→ビルド→Pages公開を実行し、PRでは検証のみ実行します。公開URLの変更時は `site.config.json` の `url`（末尾 `/`）を更新。`SITE_URL`でも上書きできます。

公式参考：[GitHub Pagesのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Open-Meteo Forecast API](https://open-meteo.com/en/docs)。天気の地域は `public/assets/app.js` のAPI URLで設定します。

## 毎朝06:00開始・07:00公開への引き継ぎ

[運用手順](docs/morning-pipeline.md)、[ChatGPTへ渡すプロンプト](docs/chatgpt-morning-prompt.md)、[編集方針](docs/editorial-policy.md)を参照。草稿・検証・反映・公開確認の道具は実装済みです。収集・スケジュール・チャット通知を自動実行する接続は、このリポジトリでは有効化していません。
