# JAMIO NEWS / じゃみお新聞

じゃみお向け個人ニュースサイト。毎日の「じゃみお朝刊」をMarkdownで蓄積し、GitHub Pagesで静的配信します。

- トップ：3分で読むトップ5、今日のいちき串木野の天気、一面、重要セール。
- AI / テック、PC・半導体、価格ウォッチ / セール、鹿児島・いちき串木野、経済・生活、過去号、注目テーマ。
- スマホ対応、システム連動＋手動ダークモード、本文検索、タグ、RSS。
- 確認済み事実 / 報道 / 未確認情報の表示。出典・検証メモ・訂正履歴。
- 価格履歴：現在の観測価格、30日前比、観測最安、買い判断。

**初期コンテンツは2026-10-04の開設号（編集ガイド）です。最新ニュースや実売価格は未収集。自動収集・朝8時のチャット配信は未有効化です。** 天気だけは閲覧時に外部APIから取得します。

## ローカルで確認

Node.js 22以上。外部パッケージのインストールは不要です。

```sh
node --test
node scripts/build.mjs
node scripts/serve.mjs
```

プレビュー：http://127.0.0.1:4173/jamio-news/

## 記事を追加

`content/articles/` に記事、`content/editions/` に日付別の朝刊を追加します。標準的なMarkdownの先頭に、`---`で囲んだJSONメタデータを置きます（JSONはYAMLのサブセット）。見出し、段落、箇条書き、番号リスト、太字、リンク、引用、インラインコード、コードブロックに対応。生HTML・画像・表・入れ子リストは本文レンダラーの対象外です。価格表は構造化データから生成します。

```sh
node scripts/new-edition.mjs 2026-10-05
```

`drafts/2026-10-05/` に朝刊と記事のひな型を生成します。草稿はサイトに出ません。裏取り済みの記事を `content/articles/`、5記事を選んだ朝刊を `content/editions/` へ移し、検証・ビルドします。

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

- カテゴリキー：`ai`, `hardware`, `deals`, `local`, `life`。
- 確認状態：`verified`, `reported`, `unconfirmed`。開設ガイドは `kind: guide`, `status: editorial`。
- 出典種別：`official`, `paper`, `github`, `blog`, `media`, `x`。
- `verified`はX以外の一次資料必須、`reported`は報道出典必須、Xがあれば`verificationNote`必須。
- 朝刊：`top5`（5件）、`hero`、`articles`（全記事）、`deals`（その号の重要セール）を記事slugで参照。
- 訂正時は`updated`、`corrections`を記載。既存号を消さず、出典と訂正履歴を残します。

検証はメタデータの抜けや矛盾を止めるもので、記事の主張を自動的に事実確認するものではありません。編集者が原典と主張を照合する必要があります。

## 価格履歴

`data/prices.json` に観測行を追加します。商品名`product`、型番`sku`、店舗`shop`、条件`condition`、通貨`currency: JPY`、税込送料込`total`、出典`url`、JST観測日時`observed`、判定`verdict`（`buy`, `conditional`, `wait`）、理由`reason`を保存。30日前比は同じSKU・店舗・条件で、30日前以前の最も近い7日以内の記録を使います。データ不足なら変化率を表示しません。

## 公開

このリポジトリは公開リポジトリです。GitHub Pagesも公開サイトです。秘密鍵・認証情報・個人的な非公開情報は保存しません。

GitHub Settings → Pages → Build and deployment → Source を **GitHub Actions** に設定します。`main`への更新でテスト→ビルド→Pages公開を実行し、PRでは検証のみ実行します。公開URLの変更時は `site.config.json` の `url`（末尾 `/`）を更新。`SITE_URL`でも上書きできます。

公式参考：[GitHub Pagesのカスタムワークフロー](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages)、[Open-Meteo Forecast API](https://open-meteo.com/en/docs)。天気の地域は `public/assets/app.js` のAPI URLで設定します。

## 将来の毎朝8時の流れ

[収集・生成の運用案](docs/morning-pipeline.md)と[編集方針](docs/editorial-policy.md)を参照。現時点では日刊スケジュールやAI生成API、チャット通知を有効化していません。
