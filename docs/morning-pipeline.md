# 朝8時の制作・公開ハンドオフ（外部スケジュールは未接続）

日本時間で朝8時ごろ、情報収集 → 検証 → 朝刊生成 → GitHub反映 → Pages公開確認 → チャットへトップ5とリンク、の順で運用する想定です。収集・原典確認・生成に時間がかかるため、8時配信を目指すなら事前に収集を開始します。GitHub Actionsの定期実行は遅延や未実行があり、厳密な8時保証には使えません。

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
| `drafts/YYYY-MM-DD/articles/YYYY-MM-DD-<slug>.md` | title, summary, category, tags, status, kind=news, published, verificationNote, sources, 空でない本文 | `content/articles/` の同名ファイル |
| `drafts/YYYY-MM-DD/edition.md` | title, kind=daily, published, top5, hero, articles, deals, production, 空でない本文 | `content/editions/YYYY-MM-DD.md` |
| `drafts/YYYY-MM-DD/prices.json` | 今日の観測のJSON配列。観測なしは `[]` | `data/prices.json` に履歴追記 |

articleのcategoryは `ai/hardware/deals/local/life`、statusは `verified/reported/unconfirmed`。sourcesは1件以上で、各要素に `title/type/url/checked` が必須。typeは `official/paper/github/blog/media/x`。verifiedにはX以外の一次資料、reportedにはmediaが必要です。ガイドは日刊記事に使用できません。タグは文字列の重複なし配列です。

editionのtop5は重複なし5件。top5・heroはarticlesに含まれ、articlesは草稿の記事ファイルと完全一致します。dealsは同号のdealsカテゴリ記事だけ、なければ `[]`。記事slugは号の日付で始まり、article/editionのpublishedは同じJST日付で、記事が号より後になることはありません。チェック時刻はarticleのpublished（訂正時はupdated）以前です。08:00を過ぎて確認したものはpublishedを実際の制作時刻へ修正し、08:00に完成したと偽らないでください。

productionは `{"contractVersion":1,"x":{"status":"unavailable","note":"実際の取得不可理由と代替確認先"}}` の形です。statusは `available/partial/unavailable/not-used`、noteは空でない文字列。unavailable/not-usedの号でXを取得済み出典にすると停止します。X取得済みならsourceに `author/postPublished/claim/identityNote` も必須。postPublishedはJST換算した実際の投稿時刻です。XのURLをofficialなどと偽装しても、ホスト名で判定します。partialでは実際に取得できた範囲と失敗範囲をnoteに書きます。

価格行は `product/sku/shop/condition/currency/total/url/observed/verdict/reason` が必須。currency=JPY、totalは正の安全な整数で税込送料込み、verdictは `buy/conditional/wait`。observedは同じJST日付かつ号のpublished以前。送料や購入条件が不明な観測は省略します。同じSKU・店舗・条件・観測日時の重複、内容相違による上書き、架空の例示URLを拒否。比較できる過去データがなければ30日前比を作りません。

## 正確な実行手順

1. 今日の日付をAsia/Tokyoで決定。開始時点の最新main、同日の既存号、`daily/YYYY-MM-DD` ブランチ/PR、配信台帳を確認します。途中でJST日付が変わった場合は停止して、翌日の別実行として調査し直します。
2. cleanな隔離チェックアウトで `git fetch origin main`、最新mainから `daily/YYYY-MM-DD` ブランチを作成します。既存ブランチ/PRがあれば状況を調べて再開し、別の同日PRを作りません。並行して同じチェックアウトへ書き込まないでください。
3. `node scripts/new-edition.mjs YYYY-MM-DD`。草稿の再初期化は拒否します。既存草稿はそのまま編集して再開できます。生成されるのは空の参照・本文・価格配列だけで、公開可能なサンプル記事を生成しません。
4. 調査・原典照合・記事作成後、`node scripts/daily.mjs check drafts/YYYY-MM-DD`。無変更で全パッケージと既存リポジトリを検証します。5件揃わない場合や裏取り不足は創作で埋めず、この段階で中止します。
5. `node scripts/daily.mjs apply drafts/YYYY-MM-DD`。すべての検証・衝突検査が完了してから保存します。通常の書き込み例外は新規ファイルを取り消し元の価格履歴を復元します。OS停止・プロセス強制終了までトランザクション保証するものではありません。その場合は公開せず、隔離チェックアウトの差分を調べ、部分書き込みを破棄して最新mainから再開します。
6. `node scripts/validate.mjs`、`node --test`、`node scripts/build.mjs` を順に実行し、記事・出典・価格・差分をレビューします。`content/articles/`、`content/editions/`、必要時の `data/prices.json` だけをコミット・pushしてPRを作成。草稿・個人情報・秘密・配信台帳を公開しません。通常の朝刊でスクリプト/契約/CIを変更して検証を回避しません。
7. PRの正確なheadに対するCI成功を確認し、レビュー条件と実行環境の承認条件を満たしてマージ。mainが先に進んだら最新mainを取り込み、同日号・価格衝突と検証を再確認します。force-pushで相手の変更を消しません。
8. マージ後のmainをfetch/check outし、公開対象の40桁SHAを取得します。そのSHAの `Publish JAMIO NEWS` 成功を待ち、`node scripts/daily.mjs confirm YYYY-MM-DD <SHA>`。成功になるまで通知しません。待機/キャッシュ遅延は30秒程度の間隔、最大10分を目安に再確認。失敗が続いたら「公開確認待ち」または実際の失敗を報告し、次回は確認段階から再開します。
9. `status: published` になってからトップ5＋editionUrlをチャットへ届け、送信成功後に外部の永続台帳へ日付・URL・digest・送信先・送信完了を記録します。台帳を確認できない、送信したか不明な場合は重複送信を止めます。

PRでもmainでも、CIは `validate.mjs` → 全テスト → buildで契約を検証します。手でcontentを書いても日刊号の必須metadataを省略できません。RSS/search件数のテストは公開コンテンツ数から算出するため、正常な日刊追加で壊れません。

## 再実行・訂正・失敗

- 既存号と全記事・本文・観測が同一ならapplyは `unchanged`。JSONのキー順は比較に影響しません。記事や本文の相違、同日の観測追加/削除/変更は衝突として停止します。価格は既存履歴の順序を保って追記し、再送草稿も観測の順序を維持します。
- 同日の号がmainにあればinit/applyを繰り返さず、mainの公開確認・未配信通知だけ再開します。Pages失敗のために同じ号を再生成しません。最新mainが先のコミットに進んでいても、同じ号のdigestが一致する最新mainの公開を確認できます。
- 訂正は通常の朝刊追加とは別のレビュー済みPR。記事の `updated`（published以降のJST時刻）と `corrections` をセットで残し、検証メモ・出典を更新します。旧号を削除せず、価格履歴をこっそり書き換えません。訂正の再通知は別途明示された場合だけ行います。
- CLIの失敗は非ゼロ終了＋stderrの `{"status":"failed","error":"具体的な理由"}`。check=`valid`、apply=`applied/unchanged`、init=`draft` は公開成功を意味しません。調査不可・権限不足・CI失敗・公開未確認・通知失敗を停止地点とともに外部実行ログへ残します。

## 公開確認と最終URL

buildは `dist/publication.json` にcommitと各号のdigestを生成し、各号HTMLにも同じdigestを埋め込みます。digestは号・参照記事・同日の価格観測の内容から算出します。MarkdownのCRLF/LFとJSONのキー順を正規化するためWindowsとLinuxで一致します。CIでは `GITHUB_SHA`、ローカルではGit HEAD（Git情報がないプレビューはnull）を利用するため、ローカルbuildだけでデプロイを証明することはできません。

confirmは、指定main SHAのPagesワークフロー成功、公開publication.jsonのcommit/date/URL/digest、一致する号HTMLのcanonical/digestをすべて照合します。HTTP 200やトップページの表示だけで成功にしません。失敗時はeditionUrlを予想で「公開済み」と知らせません。ネットワーク呼び出しは1件15秒のタイムアウト、1実行で確認し、外部実行側が上記の上限付き再試行を担当します。

成功結果はJSON：`status=published`、`date`、`editionUrl`、`commit`、`digest`、`workflowUrl`。完全版URLは `https://hm2236.github.io/jamio-news/editions/YYYY-MM-DD/`。チャットへの機械可読最終結果にもconfirmの値をそのまま含めます。公開manifestは配信台帳ではなく、厳密な一度だけ送信やチャット到達を保証しません。

## ChatGPT 08:00 JSTタスクに渡すもの

[実行プロンプト](chatgpt-morning-prompt.md) を既存タスクへ渡し、毎日08:00・Asia/Tokyoを明示します。08:00に起動する設定は制作完了時刻ではありません。08:00配信を目指す場合は先行調査を別途設定し、遅延時の扱いを決めます。この変更はタスク作成・既存タスク変更を行いません。

必要条件はNode.js 22以上でclone・スクリプト/テストを実行できる環境、調査・原典の閲覧手段、対象repoに限定したGitHub Contents/PRのwrite権限と通常のマージ権限、Actionsを読み取る手段、チャット通知先と永続的配信台帳です。GitHub認証は外部接続/credential store/環境変数のみ、Gitへ保存しません。confirmは公開repoの読み取りが可能で、APIレート制限に必要なら外部の `GITHUB_TOKEN` を使います。

Webの予定タスクはそのチャットで利用可能な接続ツールを使いますが、ローカルフォルダを継続保持しません。各回にrepoから必要なコード・契約を取得し、実行環境で検証できることを事前に1回試します。接続が読み取りだけの場合や実行環境がスクリプトを実行できない場合は公開を中止し、承認済みの制作環境へ引き継ぎます。デスクトップのローカル予定タスクにはPCとアプリの起動・プロジェクトの可用性が必要です。[OpenAI公式 Scheduled tasks](https://learn.chatgpt.com/docs/automations)。

予定実行の有無だけでGitHub書き込み能力が付くとは仮定しません。初回は[プロンプト](chatgpt-morning-prompt.md)を通常の実行で検証し、出典・公開確認・通知先を確認してから既存朝刊タスクへ適用します。ニュースと価格を生成するAPIやXアクセスが、この契約によって自動的に有効になることはありません。

## 未設定の接続

- 収集に使うAPI / フィード / X閲覧アクセスと、実売価格を追う販売店。
- 記事生成を実行する手段と、その原典確認・レビュー方法。
- 更新に用いる最小権限のGitHub認証。
- チャット通知先と、通知を実行する環境。

現在有効なワークフローは、記事更新時の静的ビルドとPages公開のみです。朝8時の収集やチャット配信を実行するワークフローはありません。

参考：[GitHub Actionsのscheduleイベント](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule)。
