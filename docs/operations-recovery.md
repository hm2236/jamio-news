# JAMIO NEWS 実運用復旧（人間編集・公開前レビュー）

2026-10-08の復旧基準main: `258b92db13fdfc74259fb0550e7d2be883411343`。
追跡: [Issue #15](https://github.com/hm2236/jamio-news/issues/15)。
Benchmark #1 / #38/#39/#40/#43と比較用テスト・採点条件は凍結。スケジュールはユーザー確認により全部一時停止中。ここでは再開・merge・公開・production設定・秘密情報を変更しない。

## 現在の停止地点

| 区分 | 状況 |
| --- | --- |
| 既刊サイト | main Pages run 37611983928成功。最後は10/6朝刊・夕刊。exact SHA receipt/HTMLを復旧workflowで再確認する。 |
| 制作の運用停止 | ChatGPT予定制作は全部一時停止。10/7・10/8の号がない。新しいタスクの重複登録や自動再開はしない。 |
| GitHub collector | 10/8 run 37708022976は09:29:20 JSTに作成（06:00目標から3h29m20s遅延）。14入口取得、OpenAI403、awaiting-editorial。原稿は生成していない。GitHubのschedule実行記録とユーザーが停止したChatGPTタスクは区別する。 |
| 期限切れ | 同collector epochは11:29:20 JSTで2時間期限終了。14日artifact保持を制作の有効期限に代用しない。 |
| 未接続 | producer handoff / autonomous writer / merger / notifier。#37はcomments=0、mainにingress workflowなし。朝刊collectorは朝刊のみで、夕刊の自律制作はない。 |
| Radar部分劣化 | run 37743517204はworkflow success、内部health=degraded。鹿児島https-equivalence-needs-review、HN/Anthropic取得可。#27の7連続日受入は未達。本文証拠や記事生成の代用にならない。 |
| サーバー保護 | active main ruleset 24643329: PR必須、build/daily-guard必須、strict=true、通常mergeのみ、force push/deletion拒否、bypassなし。daily ruleset 24643660: force push拒否。過去の「保護なし」監査は履歴。 |

README、編集方針、publishing/daily guardは現行契約のまま使う。
朝刊トップ5、夕刊は重要更新がある場合だけ1〜5本。夕刊なしは障害とは限らず、17:00の編集判断として理由を記録する。空号や埋め草を作らない。

## 最短の復旧経路

1. 人間/対話ChatGPTが今日の原典を実際に読み、記事と確認時刻を作る。新規LLM API課金は不要。原典の事実照合は構造検証では代行できない。
2. 現行publishing契約のJSON bundleを、最新main SHA付きpacketにする。
3. 復旧branchのPRでGitHub Linux上のpreviewを実行する。Windows/ローカルNodeに依存しない。productionには書かない。
4. 出典、主張、プレビュー、既刊digest、ファイル一覧を人がレビューする。
5. 別の `daily/<edition-slug>` branchを最新mainから作り、packetではなくレビュー済み記事・号だけを提出する。既存daily branch/PRがあれば所有者と調整する。通常Contents create-onlyなら記事を先に1file/commit、同じCandidate-Attempt trailerで、号を最後のimmutable sealにする。価格を載せる場合は単一commitの既存契約と分ける。
6. trusted mainのDaily publication guardと正確なhead/baseのbuild CIが成功しても、previewやCIはmerge許可ではない。ユーザーの明示承認を得てからmerge/公開する。
7. 正確なmerged mainのPages成功と対象slug/variant/URL/digest/HTMLを確認して初めてpublishedとする。別SHAの成功で代用しない。

基盤PRと日刊PRは分離する。この復旧PRをmergeしなくても、隔離branchのpreview workflowを使って原稿のレビュー準備は可能。日刊PR自体は現在mainにある既存guard/buildで検証できる。

## Packetとプレビュー

packetのshape（具体的な記事データは `contracts/publishing.schema.json` の現行bundle契約）:

```json
{
  "version": 1,
  "baseSha": "<fresh mainの40桁SHA>",
  "package": {
    "date": "YYYY-MM-DD",
    "edition": {},
    "articles": [],
    "priceObservations": []
  }
}
```

上の空欄は説明用で、実行可能な記事fixtureではない。JSONのslug/bodyはbundle側に含め、保存用Markdownではfilename/bodyへ移す。新規朝刊/夕刊のdate/variant/priceKeys、source checked、X利用状況、記事本数、時系列を埋める。取得していない出典や価格を作らない。

1回に公開可能な情報だけを含む `recovery-packets/<edition-slug>.json` を1個、隔離復旧branchに追加しDraft PRを作る。公開GitHubなので個人情報、鍵、非公開資料を入れない。packetは最終日刊PRやmainにmergeしない。
packetは1MiB以下、fresh main SHA、今日のJST日付、明示morning/evening必須。

`Recovery preview (no publication)` はPRでのみ起動し、schedule / push / workflow_dispatch / deploy / writerを持たない。contents:readのみ、checkout credentials非永続、secret・package installなし、Linux/Node22/10分。
元mainの別checkoutとPR toolingを分離し、ライブmain/daily branch/PRをpreviewの前後にread-only照合する。読み取り不能/衝突/base前進で拒否する。最終read後のraceは原子的に保証しない。最終日刊PRのtrusted guard、原典レビュー、承認時のfreshness/head/base確認が別途必須。

検証は既存validatePackage → planDraft → scratch apply → validateDailyChange → buildを使用。ソースcheckoutへの記事/価格書き込み0。既刊digest保存、今日のJST/future timestamp、最終JST rolloverを確認する。previewは信頼済みcollector receipt/producer認証ではなく、人間レビュー用の候補。

artifact（7日）:
- `recovery-live-status-<run>-<attempt>`: 現行mainの公開号を実GETで再検証。今日の朝刊欠落と、夕刊の要編集判断を区別。スケジュールの稼働はこのscriptで調べない。
- `unpublished-recovery-preview-<run>-<attempt>`: packetがある場合のみ。README.txt、preview.json、candidate-files.json、site/。`publicationAuthorized=false` / `editorialReviewRequired=true`。site/publication.jsonは仮想buildのreceiptで、本番公開証明ではない。


### ローカルサーバー不要の見た目レビュー

実記事packetを入れてpreview workflowが成功すると、通常のartifactに以下が追加される。

- **offline-review.html**：号の実HTMLと記事本文を1ファイルにまとめ、現行サイトのCSSを埋め込んだ**オフライン紙面**。ZIPを展開してファイルをダブルクリックするだけでブラウザ確認できる。Windows / Node / ローカルHTTPサーバー不要。
- **offline-review.json**：対象slug、base SHA、プレビューdigest、記事本数、単一HTMLのSHA-256、publicationAuthorized:false。受入時にCIログと照合する。

このファイルは既存レンダラーが生成した号ページと記事ページから生成し、CSSだけをインライン化する。JavaScriptを除去し、CSPで通信・スクリプトを禁止する。記事見出し・レイアウトと出典リンクの描画確認に使い、動的な天気・検索・切替機能の動作証明にはしない。サイト内ナビゲーションはローカル紙面内に限定し、外部の公式出典リンクはクリックすると別サイトへ移動するので閲覧時に確認する。

ブラウザで開くための手順：
1. **Recovery preview (no publication)** の成功したrunから unpublished-recovery-preview 成果物をダウンロード。
2. ZIPを展開し、**offline-review.html** をChrome等で開く。CSSや文章はインラインで表示される。
3. 「未公開・編集確認用」表示と号・記事・出典・掲載時刻を確認。offline-review.json のdigest/SHAを同一artifact内のpreview.jsonと照合。

GitHubリポジトリは公開のため、packetや成果物を**秘密のURLやアクセス制御された非公開データとはみなさない**。ここでの「未公開」は本番Pagesで発行されていない意味。packetが入ったテストPRは公開前承認に使わず、証拠を保存したらクローズしてmergeしない。単一HTMLも「published」ではなく、独立レビュー待ちの候補である。

packetなしのCIは合成朝刊5本・夕刊1〜5本のリハーサルと既存サイトread-only確認だけ。実ニュース生成、実日刊PR、スケジュール再開、公開完了を主張しない。

ローカルの正常な別環境でも利用可:

```sh
# fresh exact main checkoutで。outputはcheckoutの外に、新規directoryとして置く。
node /path/to/recovery-branch/scripts/recovery-preview.mjs /path/to/packet.json /path/to/unpublished-output
node /path/to/recovery-branch/scripts/recovery-status.mjs /path/to/new-status.json
```

## #45の位置づけと再開判断

#45のtrusted original-event enrichmentは、producerが提出するuntrusted URLをtrusted collector artifactへ安全に昇格する無人ingress用の課題。index-only collectorをevaluateDraftへ通すために検証を緩めない。本復旧ではenrich/evaluate/collector/ingress/比較候補を変更しない。人間が原典を読み、現行publishing契約とtrusted daily guardを使う経路の必須要件ではない。

再開する前にユーザーが決める事項:
- 制作予定タスクをいつ再開するか。既存タスクID/接続能力を確認し、重複登録しない。
- 最初は人間承認の刊行で復帰するか、別の無人接続設計を承認するか。
- 実際の記事の原典レビューを終えた日刊PRのmerge/公開承認。

復旧で原稿作成・プレビュー・CIまで準備しても、これらの承認は推測しない。17:00夕刊判断は現行方針を維持し、毎日夕刊必須へ仕様変更しない。
