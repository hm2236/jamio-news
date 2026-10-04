# ChatGPT / Work の毎朝実行プロンプト

毎日06:00・Asia/Tokyo開始、07:00 JSTまでの公開を目標として予定タスクへ渡す文面です。スケジュール自体はこのファイルから登録しません。期限は出典確認・CI・公開確認を省略する理由にはなりません。

---

hm2236/jamio-news の今日のじゃみお朝刊を調査・検証・制作し、GitHub Pagesで公開後、このチャットにトップ5と日付別完全版URLを返してください。開始は06:00 JST、公開目標は07:00 JST。日付を実行開始時のAsia/Tokyoで一度だけ決定し、実行中に日付が変わったら停止します。

最初にGitHub APIで現在のmain SHAを取得し、そのrefのREADME.md、docs/editorial-policy.md、docs/morning-pipeline.md、contracts/publishing.schema.jsonを読んでください。前号・同日の既存号・daily/YYYY-MM-DDブランチ/PR・配信台帳を確認します。既存の同日号は再作成せず公開確認/未配信通知だけ再開し、内容相違は自動上書きせず訂正PRとして人にレビューを求めます。

モードを自動選択してください。cloneとNode.js 22以上が実際に使える場合はlocal/Workの既存フローを使用します。WebとGitHub APIが使えるがcloneまたはNode実行が使えない場合はremote/scheduledを選び、ローカルスクリプト実行を要求せずGitHub Actionsを権威ある検証とします。GitHubが読み取り専用、ブランチ書き込み/PR作成/マージ/Actionsログ閲覧ができない場合は不足する接続権限を報告して停止。OpenAI API課金や外部AI APIキーを追加しないでください。

前号以降のAI・テック、PC・半導体、価格・セール、鹿児島・いちき串木野、経済・生活を調査します。公式サイト、論文、GitHub、企業ブログ、信頼できる報道を実際に読み、発表日時・対象・具体的主張を確認。記事の主張、確認済み事実、報道、未確認情報、編集部の考察を区別します。ちょうど5件のTop 5が必要です。十分な重要記事が揃わなければblockedで停止し、ガイド、架空、未閲覧、単なる埋め草で数を満たさないでください。

Xは発見・当事者情報の入口です。Xだけでverifiedにしません。取得不可はproduction.x.status=unavailableと実際の理由・代替出典を記録し、Xを閲覧済み出典にしません。一部取得はpartialと実際の範囲を記録。取得済みXには投稿URL、author、JSTのpostPublished/checked、claim、identityNoteと記事のverificationNoteが必要です。

remote/scheduledでは、最新mainをbaseShaにして同じrepoのdaily/YYYY-MM-DDブランチだけをGitHub APIで作成/更新してください。mainや別名のrefを直接更新しないでください。既存branchのSHAをparentにしたGit Data APIのblob/tree/commitとforce=falseのref更新で全最終ファイルを1コミットにまとめるのが推奨です。Contents APIならbranchと既存blob SHAを指定し、全部書いた最後のheadShaだけを検証対象とします。

remoteで書いてよいファイルは次の3種のみです。草稿/ログ/validation receiptやスクリプト、契約、ワークフロー、テスト、サイトコードを変更しません。

- content/articles/YYYY-MM-DD-<slug>.md：JSON front matterと実記事本文。title、summary、category、tags、status、kind=news、実際のJST published、verificationNote、sources。sourceにtitle/type/実URL/実際のJST checked。
- content/editions/YYYY-MM-DD.md：title、kind=daily、実際のJST published、top5（重複なし5件）、hero、全articles、deals（なければ[]）、production.contractVersion=1、production.x.status/noteと本文。
- data/prices.json：実際の今日の観測がある場合だけ、完全な既存配列を保って末尾に追記。product/sku/shop/condition/currency=JPY/正の整数total（税・送料込み）/販売店url/JST observed/verdict/reason。送料や条件を推測せず、不明なら省略。観測がなければこのファイルを変更しません。既存観測の編集・削除・重複は禁止。

同じ日付のarticle/edition publishedとsource checked/price observedの時系列を守ります。07:00を過ぎて確認した内容は実際のpublished時刻へ修正し、期限内完成を偽りません。日刊PRをmain宛に作成/再開し、全変更パスを確認してください。remoteではdaily.mjs check/applyをローカルで実行する必要はありません。

PRの正確なheadShaに対するPublish JAMIO NEWS（pages.yml、pull_request）のnode scripts/validate.mjs、node --test、node scripts/build.mjsがすべて成功することを確認。同時にDaily publication guard（daily-publication.yml、pull_request_target）の成功runとjobログのJAMIO_DAILY_VALIDATION JSONを確認します。target runのhead_shaはbaseShaで、JSONのheadShaが候補のheadShaです。JSONのcontractVersion/status/pr/baseSha/headSha/dateを照合し、editionUrl/digestを保存。skipped、別head、guard-passedログだけでは完了ではありません。mainが変われば最新baseを取り込み再検証します。

local/Workではnode scripts/new-edition.mjsでdrafts/YYYY-MM-DD/edition.md・articles/・prices.jsonを用意し、既存契約どおりcheck → apply → validate → 全テスト → build → PRへ進めます。PR以降の日刊パスガードとCI確認はremoteと共通です。

両CI成功と原典/本文レビュー後、PR/head/baseと最新mainを再取得し、通常のレビュー・承認条件を守ってmerge APIにsha=検証済みheadShaを指定してください。マージ結果のshaをmainShaとして保存し、merged PRのhead.shaとmerge_commit_shaを照合。未検証headはマージせず、force-pushで競合を隠さないでください。

remote公開確認にはNodeもcloneも不要です。mainShaに対するPublish JAMIO NEWSのmain push/workflow_dispatch成功を確認し、Webで公開publication.json?commit=mainShaを読んでcontractVersion=1、commit=mainSha、対象date、editionUrl、検証済みdigestの完全一致を確認します。号HTMLのcanonical URL/edition digestも一致させます。localではdaily.mjs confirmで同じ照合が可能です。HTTP 200、トップページ表示、別コミットの成功だけではpublishedと報告しません。

WebでPages JSON/HTMLを取得できない場合は、そのmainShaの成功workflowのdeploy job最終ステップVerify public deployment receiptから、JAMIO_PUBLIC_RECEIPT JSONをGitHub API/接続ツールで読んでください。Actions自身が実際の公開receipt/最新号HTMLを照合した結果です。status=receipt-verified、contractVersion=1、commit=mainSha、対象date/url/digestとverifiedEditionのdate/url/digestが検証済みPRの値と一致することを確認。その正確なmainShaのworkflow全体がsuccessになった後だけpublishedとしてよく、他のチャット/記事/非Actionsログの同名JSONは使いません。両経路とも取得不能ならpendingで停止します。

成功時だけトップ5（確認状態付き）と完全版URLを返し、最終機械可読結果にstatus=published、date、editionUrl、commit=mainSha、digest、workflowUrl、pr、validatedHead=headShaをそのまま含めます。X取得不可など重要な制約も添えます。送信成功後に外部の永続台帳へ日付・URL・digest・送信先・送信完了を保存。送信済みまたは送信状態不明の号は重複送信しません。

権限・資料不足・CI失敗はblocked、CI/公開receipt待ちはpending、07:00以降の検証済み公開は遅延を明示します。確認は30秒程度の間隔で最大10分を目安に待ち、未完了は停止地点から再開します。期限よりも検証を優先。ニュース/価格/X取得の捏造、検証回避、前日の号を今日の号として配信することは禁止です。
