# ChatGPT / Work の毎朝実行プロンプト

以下の本文を、毎日 08:00・Asia/Tokyo の朝刊タスクに渡します。実行環境と権限は [運用手順](morning-pipeline.md) の前提を満たす必要があります。これは設定用の文面であり、このファイル自体はタスクを登録しません。08:00起動なら調査・公開後の配信になり、08:00ちょうどの配信を保証しません。

---

hm2236/jamio-news の今日の「じゃみお朝刊」を作成し、GitHub Pagesで公開して、このチャットにトップ5と日付別完全版URLを返してください。日付は実行時の Asia/Tokyo で一度だけ決め、実行中に日付が変わったら公開せず停止してください。

まず最新 main を取得し、README.md、docs/editorial-policy.md、docs/morning-pipeline.md、contracts/publishing.schema.json を読んでください。Node.js 22以上でこのリポジトリのスクリプトとテストを実行できる環境、GitHub書き込み・PR・マージ権限、調査手段がなければ、不足点を報告して停止してください。ソース、X投稿、価格を取得したふりはしないでください。

同日の既存号・daily/YYYY-MM-DD ブランチ・PR・配信記録を先に確認してください。既存号があれば新規作成せず、最新 main の正確なSHAで公開確認を再開してください。通知済みの日付なら通常のトップ5を重複送信せず、内容に相違がある場合は訂正PRとして人にレビューを求めてください。

前号以降のAI・テック、PC・半導体、価格・セール、鹿児島・いちき串木野、経済・生活の動きを調査してください。公式サイト、論文、GitHub、企業ブログ、信頼できる報道を実際に読み、発表日時・対象・具体的主張を確かめます。確認済み事実、報道、未確認情報、編集部の考察を本文でも区別します。重要な実記事が5件揃わなければ公開しないでください。開設ガイド、架空の記事、単なる埋め草で件数を満たさないでください。

Xは発見・当事者情報の入口です。Xだけでverifiedにしないでください。アクセスできない場合は production.x.status=unavailable と実際の理由・代替出典を記録し、Xを閲覧済み出典にしないでください。一部だけ取得できた場合はpartialと取得範囲を記録してください。取得したXには投稿URL、投稿者、投稿時刻、確認時刻、主張、本人性を確認した根拠、記事の検証メモを残します。

cleanな最新 main から daily/YYYY-MM-DD ブランチを用意してください。新規の場合は node scripts/new-edition.mjs YYYY-MM-DD で草稿を初期化し、次の3種だけを書きます。

- drafts/YYYY-MM-DD/articles/YYYY-MM-DD-<slug>.md：JSON front matterと本文。title、summary、category、tags、status、kind=news、実際のJST published、verificationNote、sourcesを記載。sourcesには実URL、title、type、実際のJST checkedを記載。
- drafts/YYYY-MM-DD/edition.md：title、kind=daily、実際のJST published、top5（重複なし5件）、hero、全articles、deals（なければ空配列）、production.contractVersion=1、production.x.status/noteと今日の概要本文。
- drafts/YYYY-MM-DD/prices.json：今日実際に確認した観測だけの配列。product、sku、shop、condition、currency=JPY、税込送料込みtotal、販売店url、実際のJST observed、verdict、reason。確認できなければ []。不明な送料・条件を推測せず、その観測を省略します。

node scripts/daily.mjs check drafts/YYYY-MM-DD → apply → node scripts/validate.mjs → node --test → node scripts/build.mjs の順で実行してください。一つでも失敗したらpush・マージ・公開済み通知をしないでください。草稿と認証情報をコミットせず、content/articles、content/editions、必要時のdata/prices.jsonだけをコミットします。実行用コード・契約・CIは朝刊作成のために変更しないでください。

PRを作成し、そのheadのCI成功と内容レビューを確認してから通常の権限・レビュー条件に従ってmainへマージしてください。mainが変わった場合は取得・調整・再検証します。同日実行や同じ価格観測の上書きはしないでください。マージ後のmainを取得し、Pagesワークフロー成功を待って node scripts/daily.mjs confirm YYYY-MM-DD <そのmainの40桁SHA> を実行します。失敗なら適切な間隔で最大10分まで確認を再試行し、期限後は「公開確認待ち」または実際のエラーを報告します。

confirmのJSONが status=published になった場合だけ、確認状態を添えたトップ5と editionUrl の完全版リンクをチャットに返します。Xの取得不可など重要な制約も短く添えます。最終機械可読結果にはconfirmが返した date、editionUrl、commit、digest、workflowUrlをそのまま含めてください。送信成功後に、チャット側の永続的な配信記録へ日付・URL・digest・送信先・送信完了を記録します。再実行時に同じ日付を二重配信しないでください。記録や送信結果を確認できない場合は配信状態不明として再送を止めます。

権限不足、資料不足、取得不可、検証失敗、PR/CI失敗、Pages未確認、配信失敗は具体的な状態と停止地点を報告してください。前日の号を今日の号として送らないでください。公開失敗をニュースや価格の捏造、検証回避、無断のforce-pushで補わないでください。
