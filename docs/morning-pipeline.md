# 06:00 JST制作開始・07:00 JST公開目標のハンドオフ

自動刊行の段階導入は[Autonomous Publication v1](autonomous-publication.md)を参照。GitHub側のread-only scheduled shadow収集を追加し、既存ChatGPT予定タスクを維持します。shadowは制作・公開成功ではありません。本稿の既存daily guard/CI/merge/receipt規則を引き続き正本として使い、新しいLLM API課金を追加しません。

日をまたぐ続報は[連続ニュースのシリーズ設計](news-series-design.md)と[段階1の表示・人手登録・追加公開証明](news-series-display.md)を参照。sidecarから前後リンクをbuild時導出します。通常の日刊ではseries metadata/sidecarを追加せず、登録は別の人手レビューPRです。series公開完了はexact merged mainのPages成功と既存edition証明に加え `JAMIO_SERIES_PUBLIC_RECEIPT` のregistry/navigation digest・revision・URL・HTMLを照合します。既存号・記事・digestを変えず、同じ企業という理由だけで既刊記事を再掲しません。LLM提案と自動付与は未導入です。

毎日06:00・Asia/TokyoにChatGPT予定タスクが制作を開始し、調査 → 原典検証 → Markdown/価格観測 → GitHub PR → Actions検証 → マージ → Pages確認 → トップ5と完全版URLの順で、07:00 JSTまでの公開を目指します。GitHubは保存・検証・公開のバックエンドです。調査・生成はChatGPT予定タスクが担当し、OpenAI API課金や外部AI APIキーは追加しません。期限が来ても検証を省略せず、未完了はpending/blocked/lateと報告します。

## 同日複数版の識別と互換性

日付はJSTの`YYYY-MM-DD`、edition-slugは`YYYY-MM-DD`（旧互換）または`YYYY-MM-DD-morning` / `YYYY-MM-DD-noon` / `YYYY-MM-DD-evening`。新しい朝・昼・夕の制作は明示版を使います。同日別版は再実行ではありません。同じslugの再実行だけが既存確認の対象です。旧2026-10-04号・2026-10-05昼刊の本文、ファイル名、メタデータ、URL、digestは変更せず、receipt上はvariant=legacyとして識別します。legacyは朝刊という意味ではなく、旧形式という意味です。

明示版はkind=dailyと`date`、`variant`、`priceKeys`が必須です。date/variantはファイル名と一致させ、publishedは同じJST日付の実時刻にします。priceKeysはこの版の実観測を`[sku,shop,condition,observed]`のJSON文字列にした配列（観測なしは[]）です。草稿prices.jsonまたはremoteで追記した観測と、キー・順序が完全一致しなければ停止します。例：`priceKeys: [JSON.stringify([sku,shop,condition,observed])]`。新規記事も`<edition-slug>-<story>`で名前空間を分け、既存記事をTop 5として使い回しません。slug/date/variantを推測するためにタイトルを解析しません。

例：`node scripts/new-edition.mjs 2026-10-05-evening` → `drafts/2026-10-05-evening/` → check/apply → `daily/2026-10-05-evening`のPR → 両CI成功 → 期待head付き通常マージ → `node scripts/daily.mjs confirm 2026-10-05-evening <正確なmain SHA>`。URLは`https://hm2236.github.io/jamio-news/editions/2026-10-05-evening/`です。コード・契約・サイト生成の変更は別の基盤PRに分離し、基盤をマージしてから日刊PRを作ります。

Daily publication guardは信頼済みmainで全差分を検証し、対象版の記事・号の追加と価格の追記だけを許可します。同じ版の重複、別版の記事、既存記事/号の変更、非通常ファイル、既存価格変更、観測欠落/重複、版ごとの本数違反（朝・昼・legacyのトップ5、夕刊1〜5件）、X・出典・時系列の違反は従来どおり停止します。別版追加でも既存の全号の内容とdigestが変わらないことを検証します。旧形式digestは同日価格全体を含むため、旧形式号がある日に価格を新規追記すると旧digestが変わり、停止します。観測を捏造・省略して回避せず、その観測を載せる必要があれば明示的な別の移行設計が必要です。明示版同士では自分のpriceKeysだけをdigestへ含め、後の版の価格追加で先の版を変えません。

トップと公開確認の最新号はpublished順、同時刻はslug順。アーカイブ/RSS/サイトマップは版ごとのURLを保持し、検索は記事と所属版のタイトル・リンクを含みます。JAMIO_DAILY_VALIDATION、publication.json、JAMIO_PUBLIC_RECEIPT、最終報告はdateに加えてslug/variantを照合します。同日の別版receiptを証拠にできません。通知台帳の重複キーは送信先＋slug＋digest（dateだけでは不可）。旧API-only receiptはlegacyだけに互換を残し、新版ではslug/variantのない証拠を拒否します。両CIの正確なhead/base、merge SHA、mainのPages成功、公開URL/digestの完全一致は必須です。

## 実行モードを自動選択

- **local/Work**：cloneとNode.js 22以上が実際に使える環境では、既存の草稿 → check/apply → ローカル検証 → PR → 公開確認を維持します。
- **remote/scheduled**：Webで原典を確認でき、GitHub APIの読み書き・ブランチ・PR作成/マージ・Actionsログ参照が利用可能で、cloneまたはNode実行が使えない場合はこちらを自動選択します。ChatGPT側のclone・Node・ハッシュ計算・ローカルスクリプト実行は不要です。最終ファイルをAPIでdailyブランチへ書き、ActionsのPR CIを権威ある検証として使います。

APIが読み取り専用、PR/マージ権限がない、CIログや公開receiptにアクセスできない場合は不足する権限を報告して停止します。モード変更で出典・価格・日付・Top 5の契約は緩めません。

## 収集対象

- 公式：OpenAI、Anthropic、Google / Gemini、NVIDIA、AMD、Intelの発表・ブログ・ドキュメント。
- 技術：論文、GitHubの公開実装・リリース、ローカルLLM、AIコーディング、自動実装。
- X：研究者・開発者・最先端利用者・企業公式の投稿。公式サイトからリンクされるアカウントを確認し、台帳を作る。特定の個人名やハンドルは未設定。
- PC価格：国内販売店の実売価格、在庫、税・送料・クーポン・会員・ポイント条件。
- 地元：鹿児島県、いちき串木野市、気象庁、交通機関、信頼できる地域報道。

## 収集記録

候補ごとにURL、発信者、発信日時、取得日時、主張、原典URL、裏取り状態、追跡テーマを記録します。XのAPI・閲覧手段は契約とアクセスを確認してから設定。キーはGitHub Secretsなどへ保存し、公開リポジトリに入れません。

Xの投稿はニュース候補です。公式発表、論文、GitHub、企業ブログ、複数の信頼できる報道で内容を確かめます。確認できないものは、必要性がある場合だけ「未確認情報」として載せ、確認できていない点を書きます。閲覧できないX投稿を収集済みとしません。

## 生成から公開

1. 前号以降の候補を重複排除し、発表日時と対象地域・製品を確認。
2. 重要度、じゃみおへの関連性、検証の確かさでトップ5と一面を選択。
3. 個別Markdownに主張、影響、考察、出典、確認時刻、確認状態を記録。
4. 下記契約に従って草稿パッケージに記事・朝刊・実観測価格を記録。
5. `daily.mjs check` → `apply` → `validate.mjs` → `node --test` → ビルドを確認し、PRでGitHubへ反映。
6. Pagesの公開成功と、その日付の完全版URLを確認。
7. チャットにトップ5と完全版リンクを届ける。既送信の日付は重複送信しない。

失敗時は不完全な号を公開しません。既存号を残し、取得不可や配信失敗を記録。ページ更新失敗時は「公開済み」と通知しません。前日の号を今日の号として届けません。

## 実装済みの契約 v1

[contracts/publishing.schema.json](../contracts/publishing.schema.json) は正規化した `{date, edition, articles, priceObservations}` のJSON Schemaです。Markdownは既存どおりJSON front matter＋本文。`slug` はファイル名から、`body` は本文から読み取り、メタデータには書きません。`x-handoff` に対象リポジトリ、ファイル、コマンド、失敗・成功・再実行条件を記載しています。未知のメタデータキーも拒否します。

依存パッケージなしの `scripts/contract.mjs` が、このスキーマ内で使われているassertionと独自formatを検証します。他のJSON Schema実装で利用する際も `date`（実在する年月日）、`jst-date-time`（実在する `YYYY-MM-DDTHH:mm:ss+09:00`）、`source-url`（HTTP(S)、資格情報なし、example.com/org/net・localhost・test・invalid等の例示URL除外）を登録してください。Schemaだけでは表現していない参照・同日・時系列・出典状態ルールは `validate` / `validateDailyEdition` / `readDraft` が追加検証します。

構造検証は真偽を自動判定しません。blog/officialのラベルだけで一次資料の本人性・主張を確定せず、制作者とレビュー担当が原典を照合します。URLが形式上有効でも実際に読んでいなければ出典にできません。

| 草稿のファイル | 必須内容 | applyの保存先 |
| --- | --- | --- |
| `drafts/<edition-slug>/articles/<edition-slug>-<story>.md` | title, summary, category, tags, status, kind=news, published, verificationNote, sources, 空でない本文 | `content/articles/` の同名ファイル |
| `drafts/<edition-slug>/edition.md` | title, kind=daily, published, top5, hero, articles, deals, production, 空でない本文 | `content/editions/<edition-slug>.md` |
| `drafts/<edition-slug>/prices.json` | 今日の観測のJSON配列。観測なしは `[]` | `data/prices.json` に履歴追記 |

articleのcategoryは `ai/hardware/vr/deals/local/life`（`vr` はVR機器・VRChat（VRC））、statusは `verified/reported/unconfirmed`。sourcesは1件以上で、各要素に `title/type/url/checked` が必須。typeは `official/paper/github/blog/media/x`。verifiedにはX以外の一次資料、reportedにはmediaが必要です。ガイドは日刊記事に使用できません。タグは文字列の重複なし配列です。

editionのtop5は重複なし5件。明示夕刊（variant=evening）だけはtop5・articlesとも1〜5件を許容します。フィールド名top5は互換性のため維持します。朝刊・昼刊・legacyは従来どおりトップ5が必須です。top5・heroはarticlesに含まれ、articlesは草稿の記事ファイルと完全一致します。dealsは同号のdealsカテゴリ記事だけ、なければ `[]`。記事slugは号の日付で始まり、article/editionのpublishedは同じJST日付で、記事が号より後になることはありません。チェック時刻はarticleのpublished（訂正時はupdated）以前です。07:00を過ぎて確認したものはpublishedを実際の制作時刻へ修正し、期限内に完成したと偽らないでください。

productionは `{"contractVersion":1,"x":{"status":"unavailable","note":"実際の取得不可理由と代替確認先"}}` の形です。statusは `available/partial/unavailable/not-used`、noteは空でない文字列。unavailable/not-usedの号でXを取得済み出典にすると停止します。X取得済みならsourceに `author/postPublished/claim/identityNote` も必須。postPublishedはJST換算した実際の投稿時刻です。XのURLをofficialなどと偽装しても、ホスト名で判定します。partialでは実際に取得できた範囲と失敗範囲をnoteに書きます。

価格行は `product/sku/shop/condition/currency/total/url/observed/verdict/reason` が必須。currency=JPY、totalは正の安全な整数で税込送料込み、verdictは `buy/conditional/wait`。observedは同じJST日付かつ号のpublished以前。送料や購入条件が不明な観測は省略します。同じSKU・店舗・条件・観測日時の重複、内容相違による上書き、架空の例示URLを拒否。比較できる過去データがなければ30日前比を作りません。

## local/Workの実行手順

1. 今日の日付をAsia/Tokyoで決定。開始時点の最新main、同日の既存号、`daily/<edition-slug>` ブランチ/PR、配信台帳を確認します。途中でJST日付が変わった場合は停止して、翌日の別実行として調査し直します。
2. cleanな隔離チェックアウトで `git fetch origin main`、最新mainから `daily/<edition-slug>` ブランチを作成します。既存ブランチ/PRがあれば状況を調べて再開し、同じ版の別PRを作りません。並行して同じチェックアウトへ書き込まないでください。
3. `node scripts/new-edition.mjs <edition-slug>`。草稿の再初期化は拒否します。既存草稿はそのまま編集して再開できます。生成されるのは空の参照・本文・価格配列だけで、公開可能なサンプル記事を生成しません。
4. 調査・原典照合・記事作成後、`node scripts/daily.mjs check drafts/<edition-slug>`。無変更で全パッケージと既存リポジトリを検証します。朝刊で5件揃わない場合や裏取り不足は創作で埋めず、この段階で中止します。
5. `node scripts/daily.mjs apply drafts/<edition-slug>`。すべての検証・衝突検査が完了してから保存します。通常の書き込み例外は新規ファイルを取り消し元の価格履歴を復元します。OS停止・プロセス強制終了までトランザクション保証するものではありません。その場合は公開せず、隔離チェックアウトの差分を調べ、部分書き込みを破棄して最新mainから再開します。
6. `node scripts/validate.mjs`、`node --test`、`node scripts/build.mjs` を順に実行し、記事・出典・価格・差分をレビューします。`content/articles/`、`content/editions/`、必要時の `data/prices.json` だけをコミット・pushしてPRを作成。草稿・個人情報・秘密・配信台帳を公開しません。通常の朝刊でスクリプト/契約/CIを変更して検証を回避しません。
7. PRの正確なheadに対するCI成功を確認し、レビュー条件と実行環境の承認条件を満たしてマージ。mainが先に進んだら最新mainを取り込み、同日号・価格衝突と検証を再確認します。force-pushで相手の変更を消しません。
8. マージ後のmainをfetch/check outし、公開対象の40桁SHAを取得します。そのSHAの `Publish JAMIO NEWS` 成功を待ち、`node scripts/daily.mjs confirm <edition-slug> <SHA>`。成功になるまで通知しません。待機/キャッシュ遅延は30秒程度の間隔、最大10分を目安に再確認。失敗が続いたら「公開確認待ち」または実際の失敗を報告し、次回は確認段階から再開します。
9. `status: published` になってからトップ5＋editionUrlをチャットへ届け、送信成功後に外部の永続台帳へ日付・slug・variant・URL・digest・送信先・送信完了を記録します。台帳を確認できない、送信したか不明な場合は重複送信を止めます。

PRでもmainでも、CIは `validate.mjs` → 全テスト → buildで契約を検証します。手でcontentを書いても日刊号の必須metadataを省略できません。RSS/search件数のテストは公開コンテンツ数から算出するため、正常な日刊追加で壊れません。

## 再実行・訂正・失敗

- 既存号と全記事・本文・観測が同一ならapplyは `unchanged`。JSONのキー順は比較に影響しません。記事や本文の相違、同じ版の観測追加/削除/変更は衝突として停止します。価格は既存履歴の順序を保って追記し、再送草稿も観測の順序を維持します。
- 対象edition-slugの号がmainにあればinit/applyを繰り返さず、mainの公開確認・未配信通知だけ再開します。Pages失敗のために同じ号を再生成しません。最新mainが先のコミットに進んでいても、同じ号のdigestが一致する最新mainの公開を確認できます。
- 訂正は通常の朝刊追加とは別のレビュー済みPR。記事の `updated`（published以降のJST時刻）と `corrections` をセットで残し、検証メモ・出典を更新します。旧号を削除せず、価格履歴をこっそり書き換えません。訂正の再通知は別途明示された場合だけ行います。
- CLIの失敗は非ゼロ終了＋stderrの `{"status":"failed","error":"具体的な理由"}`。check=`valid`、apply=`applied/unchanged`、init=`draft` は公開成功を意味しません。調査不可・権限不足・CI失敗・公開未確認・通知失敗を停止地点とともに外部実行ログへ残します。

## 公開確認と最終URL

buildは `dist/publication.json` にcommitと各号のdigestを生成し、各号HTMLにも同じdigestを埋め込みます。digestは号・参照記事・対象価格観測（旧形式は同日全体、明示版はpriceKeys）の内容から算出します。MarkdownのCRLF/LFとJSONのキー順を正規化するためWindowsとLinuxで一致します。CIでは `GITHUB_SHA`、ローカルではGit HEAD（Git情報がないプレビューはnull）を利用するため、ローカルbuildだけでデプロイを証明することはできません。

confirmは、指定main SHAのPagesワークフロー成功、公開publication.jsonのcommit/date/slug/variant/URL/digest、一致する号HTMLのcanonical/digestをすべて照合します。HTTP 200やトップページの表示だけで成功にしません。失敗時はeditionUrlを予想で「公開済み」と知らせません。ネットワーク呼び出しは1件15秒のタイムアウト、1実行で確認し、外部実行側が上記の上限付き再試行を担当します。

成功結果はJSON：`status=published`、`date`、`slug`、`variant`、`editionUrl`、`commit`、`digest`、`workflowUrl`。完全版URLは `https://hm2236.github.io/jamio-news/editions/<edition-slug>/`。チャットへの機械可読最終結果にもconfirmの値をそのまま含めます。公開manifestは配信台帳ではなく、厳密な一度だけ送信やチャット到達を保証しません。

## ChatGPT 06:00 JSTタスクに渡すもの

[実行プロンプト](chatgpt-morning-prompt.md) を既存タスクへ渡し、毎日06:00・Asia/Tokyo開始、07:00 JSTまでの公開目標を明示します。この変更はリポジトリの手順を更新し、予定タスクの登録・時刻変更自体は行いません。

共通の必要条件は調査・原典の閲覧手段、対象repoに限定したGitHub Contents/Git/PRのwrite権限と通常のマージ権限、Actionsとログを読み取る手段、公開Web receiptの閲覧、チャット通知先と永続的配信台帳です。Node.js 22以上とcloneはlocal/Workにだけ必要です。GitHub認証は外部接続/credential store/環境変数のみ、Gitへ保存しません。予定タスクの既存GitHub接続を使い、新しいAI APIキーは不要です。

Webの予定タスクでは利用可能な接続ツールを使い、remote/scheduledなら各回にGitHub APIからmain・契約・過去号を読み直します。スクリプトを実行できないことはremoteの停止理由ではありません。GitHub書き込み・PR・Actions確認などの接続不足だけは解消が必要です。デスクトップのlocal/Work予定タスクにはPCとアプリの起動・プロジェクトの可用性が必要です。[OpenAI公式 Scheduled tasks](https://learn.chatgpt.com/docs/automations)。

予定実行の有無だけでGitHub書き込み能力が付くとは仮定しません。初回は[プロンプト](chatgpt-morning-prompt.md)を通常の実行で検証し、出典・公開確認・通知先を確認してから既存朝刊タスクへ適用します。ニュースと価格を生成するAPIやXアクセスが、この契約によって自動的に有効になることはありません。

## remote/scheduledのAPI手順

すべて対象は `hm2236/jamio-news`。既存の [JSON Schema](../contracts/publishing.schema.json) の必須項目と上記の原典確認ルールを使います。production metadataの形もlocalと同じで、新しいmodeフィールドは不要です。予定タスクのコンテナでcloneやNodeが使えなければ、スクリプトを実行しようと繰り返さず以下へ進みます。

1. `GET /repos/hm2236/jamio-news/git/ref/heads/main` またはbranch APIでmain SHAを取得し、そのrefでREADME・本手順・編集方針・契約・過去号・価格履歴を読みます。取得したSHAを `baseSha` として記録。同日の号・dailyブランチ・PR・通知台帳を確認します。既存の公開号は再作成せず確認/通知再開。同じ版の異なる内容は自動上書きせず別の訂正PRへ引き継ぎます。
2. 原典を実際に読み、重要記事を選択します。朝刊・昼刊・legacyは正確に5件のTop 5が必要です。明示夕刊だけは重要更新1〜5件で発行し、重要更新がなければ見送ります。架空・未閲覧・埋め草は禁止です。必要な記事や出典が不足する場合はblockedで停止。X取得不可なら `production.x.status=unavailable` と理由・代替出典。partialは実際に取得できた範囲だけを出典にします。検証が事実の真偽を自動保証するわけではありません。
3. `POST /git/refs` の `ref=refs/heads/daily/<edition-slug>, sha=baseSha` で同日ブランチだけを作成。既存ブランチは再利用してparent SHAを読み直します。mainのrefを直接更新しません。forkや別名ブランチで日刊ガードを回避しません。
4. 最終Markdownを `content/articles/<edition-slug>-<story>.md` と `content/editions/<edition-slug>.md` に直接書きます。記事・号の日付、JST実確認時刻、全slug参照、source/status、production.x、本文はlocalと同一契約。実観測がある場合だけ `data/prices.json` の完全な既存配列を保って観測を追記します。観測なしならそのファイルを変更しません。未完成草稿、validation metadata、ログなどの追加ファイルを書きません。
5. 推奨はGit Data APIのblob → 現在のbranch commitのtreeをbaseにしたtree → parentを現在のbranch SHAとするcommit → `PATCH /git/refs/heads/daily/<edition-slug>`（force=false）の順で、全最終ファイルを1コミットで更新します。Contents APIでファイルごとに書く場合はbranch指定と現在blob SHAによる衝突検出を使い、全件を書き終えた最後のbranch SHAを `headSha` として記録します。途中コミットのCIを最終検証に使いません。mainが進んだら最新mainを取り込み、再度CIを待ちます。
6. `POST /pulls` でhead=`daily/<edition-slug>`, base=`main` のPRを作成。既存の同じ版のPRがあれば更新・再開。PRの変更ファイル一覧を最後まで読み、許可範囲のみであることを確認します。ChatGPT側でlocal check/applyは実行不要。Actionsの **Daily publication guard** と **Publish JAMIO NEWS** の両方を必須として待ちます。

日刊ガードは `pull_request_target` でmainのコードを使用し、候補のGit blobだけを読みます。候補のスクリプトは実行せず、write権限・秘密・永続認証を渡しません。完全なbase/head差分で、同日記事/号の追加と価格追記だけを許可します。scripts/contracts/.github/tests/public/site.config等、削除・rename・symlink・実行可能ファイル、既存記事/号の変更は拒否します。baseはheadの祖先であることが必要です。通常の訂正は別名の明示レビュー済みPRで行います。[GitHub公式 pull_request_target](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#pull_request_target)。

価格の既存配列は変更不可のprefix。追記は同日・号のpublished以前で、重複と衝突を拒否します。書式だけ変えて価格ファイルを更新することも拒否します。API書き込み途中やguard-passedのログだけでは公開に進みません。

## remoteの検証済みheadと公開確認（Node不要）

API確認の実行可能な仕様は [scripts/remote-proof.mjs](../scripts/remote-proof.mjs) とテストにあります。ChatGPTは以下のJSONフィールドを読み取って照合するだけでよく、このファイルを実行する必要はありません。

1. PRを再取得し、open・base=main・同一repo・branch日付・head.sha=`headSha`・base.sha=`baseSha`を確認。mainも再取得してbaseShaと一致させます。変更があれば新しいhead/baseで再検証。対象headの `Publish JAMIO NEWS`（pages.yml, event=pull_request）の最新runをActions APIで調べ、`head_sha=headSha`, `head_branch=daily/<edition-slug>`, status=completed, conclusion=successを要求します。skipped/neutral/旧headの成功は不可。PR CIは必ず `node scripts/validate.mjs`, `node --test`, `node scripts/build.mjs` を実行します。
2. `actions/workflows/daily-publication.yml/runs?event=pull_request_target` を必要なページまで読み、成功runのjobログの `JAMIO_DAILY_VALIDATION ` に続くJSONを取得します。guardはbaseのコードを使いますが、API runの `head_sha` はheadShaまたはbaseShaとして表示され得ます。runのpull_requests内の対象番号/head.sha/base.shaと、JSONのstatus=guard-passed, contractVersion=1, pr=対象番号, baseSha/headSha/date/slug/variantの完全一致を要求し、editionUrlと64桁digestを保存します。run自体のstatus=completed/conclusion=successも必須です。ログが取得不能なら止まり、推測でdigestを作りません。
3. 両方の最新CI成功と原典/本文レビューを確認したら、再度PR/head/baseとmainを確認し、`PUT /repos/hm2236/jamio-news/pulls/N/merge` に **sha=headSha** を指定してそのheadだけをマージ。期待SHAが変わっていればGitHubに拒否させます。レビュー条件は通常どおり遵守し、未検証コミットを追加しません。[GitHub公式 merge API](https://docs.github.com/en/rest/pulls/pulls#merge-a-pull-request)。
4. merge結果のmerged=trueとshaを `mainSha` に記録し、再取得したPRのmerged=true、head.sha=headSha、merge_commit_sha=mainShaを照合します。単に最新mainを読み直してそのSHAをマージ結果の代わりにしません。
5. `actions/workflows/pages.yml/runs?head_sha=mainSha&branch=main` から最新のmain push/workflow_dispatch runのstatus=completed/conclusion=successを確認。`head_sha=mainSha` が必須です。別コミットのPages成功やPRのbuild成功では代用しません。
6. Webで `https://hm2236.github.io/jamio-news/publication.json?commit=mainSha` を読み、contractVersion=1、commit=mainSha、editions内のdate=対象日付、slug=対象edition-slug、variant=対象版、url=保存したeditionUrl、digest=保存した検証済みdigestをすべて照合します。号HTMLのcanonical URLと `meta name=jamio-edition-digest` も一致することを確認します。WebツールがJSON/HTMLを読めない場合は下記のActionsログ経路を使い、両方取得不能ならpendingで停止します。HTTP 200だけでは成功にしません。
7. 成功後だけ、最終結果 `{"status":"published","date":"対象日","slug":"対象edition-slug","variant":"対象版","editionUrl":"検証したURL","commit":"mainSha","digest":"検証済みdigest","workflowUrl":"mainの成功run URL","pr":PR番号,"validatedHead":"headSha"}` とトップ5/完全版リンクを返します。配信台帳と重複送信規則はlocalと共通。receiptは通知の到達証明ではありません。

WebツールがPagesのJSON/HTMLを取得できない場合のGitHub API経路もあります。mainの **Publish JAMIO NEWS / deploy** 最終ステップ **Verify public deployment receipt** が、実際の公開publication.jsonと最新号HTMLを読み、checkoutした正確なmainの内容と照合します。キャッシュ待ちは約10分を上限の目安に再試行し、不一致はworkflowを失敗させます。成功ログの `JAMIO_PUBLIC_RECEIPT ` JSONをGitHubのjob logs API/接続ツールで取得し、status=receipt-verified、contractVersion=1、commit=mainSha、対象date/slug/variant/url/digestとverifiedEditionのdate/slug/variant/url/digestを検証済みPR値と照合してください。この経路では直接Web閲覧やlocal Nodeは不要です。ログだけではpublishedにならず、そのログの正確なmain SHAのworkflow全体がsuccessであることも必須です。信頼できるGitHub Actionsログ以外からコピーした同名JSONは証拠にしません。

CI失敗・権限不足はblocked、進行中/receiptのキャッシュ待ちはpending、07:00を過ぎても検証後に公開できた場合はpublishedと遅延を明示します。07:00に間に合わせるためにCI/裏取り/receiptを省略しません。30秒程度の間隔で状態確認し、1回の公開確認は最大10分を目安に待ち、未完了なら停止地点から再開します。Pagesの別main更新により対象commitが公開されなかった場合も、そのcommitの公開済みとは報告しません。

## 未設定の接続

- 収集に使うAPI / フィード / X閲覧アクセスと、実売価格を追う販売店。
- 記事生成を実行する手段と、その原典確認・レビュー方法。
- 更新に用いる最小権限のGitHub認証。
- チャット通知先と、通知を実行する環境。

GitHubには日刊PRの信頼済みガードと検証・ビルド・Pages公開を実装しています。GitHub内でニュースを自律収集する予定実行やAI生成、チャット配信は追加していません。

参考：[GitHub Actionsのscheduleイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。

## 必要時の夕刊と表示

17:00 JSTの編集判断は[編集方針](editorial-policy.md#朝刊と必要時の夕刊)に従い、発行する場合だけ明示evening版を制作します。夕刊は記事・top5とも1〜5件、heroはその号の記事です。空の夕刊や埋め草は作りません。チェック・apply・日刊ガード・buildで同じ版別契約を検証し、公開確認は従来どおりslug/variant/URL/digestと正確なmain SHAを照合します。最終通知も実際の本数の主要ニュースと完全版URLを使用します。

トップは最新号の一面・トップニュースを表示し、同日の公開済み版だけ切り替えます。天気は共通パネルのままです。「今日の重要ニュース」は同日の各版のheroとtop5を重複なしで残し、過去号では「この日の重要ニュース」と表示します。アーカイブは日付ごとにまとめ、旧形式URL・タイトル・データ・digestは変更しません。legacyを朝刊と推測しません。この手順ファイルは予定タスク自体を登録・変更しません。
