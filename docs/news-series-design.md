# 連続ニュースのシリーズ化 — 実装前提の設計 v1

状態: **設計決定、段階1表示基盤を実装PRで追加**（2026-10-06 JST）。追跡: [Issue #18](https://github.com/hm2236/jamio-news/issues/18)。自動刊行の親テーマ: [Issue #15](https://github.com/hm2236/jamio-news/issues/15)。本書のコード・JSON・URLには将来仕様や仮想例を含むため、そのまま本番へ投入しない。

段階1の実装範囲・レビュー条件・公開確認手順は [news-series-display.md](news-series-display.md) に記録する。段階2のdetached提案・証拠binding・評価基盤は [news-series-shadow.md](news-series-shadow.md) に記録する。7連続日の実運用評価と段階3は未完了。production registryは空で、例示のOpenAI記事を登録しない。

日をまたぐニュースを、一つの出来事の変化として読み返せるようにする。LLMは意味を判断して提案し、決定論的コードは構造・参照・順序・証拠の結び付けを検証する。記事ページの前/一覧/次は保存せず生成する。シリーズ所属だけで事実の確認状態やTop 5への優先度を上げない。

## 1. 調査した正本と変更範囲

指定repoをfresh cloneして取得したmain: `92d424b231e89933b6ad53cdc46dd6992378da0b`。repo全体および作業ディレクトリの祖先にAGENTS.mdなし。以下を確認した。本書と実装済み仕様が衝突する間は、**現行mainの契約・コード・運用規則を優先**する。本書はシリーズ実装時の設計正本、Issueは進捗と受入条件の正本とする。

| 正本 | 確認した制約・接続点 |
| --- | --- |
| [README](../README.md)、[編集方針](editorial-policy.md) | JSON front matter、news/guide、verified/reported/unconfirmed、Xは発見源、朝刊5本・必要時夕刊1〜5本 |
| [制作手順](morning-pipeline.md)、[実行プロンプト](chatgpt-morning-prompt.md) | edition-slug/date/variant、旧形式はlegacy、既存号不変、基盤PRと日刊PRの分離、exact head/baseとreceipt |
| [自動刊行v1](autonomous-publication.md)、[publishing schema](../contracts/publishing.schema.json)、[autonomous schema](../contracts/autonomous.schema.json) | 未知キー拒否、read-only朝刊shadow、detached evidence、run/attempt/main固定、出版権限との分離 |
| 全17記事・4号のfront matter | seriesなし。開設guide6本、旧形式日刊5本、明示朝刊5本、明示夕刊1本。日刊記事は自分の号のslug名前空間 |
| [content](../scripts/content.mjs)、[contract](../scripts/contract.mjs)、[edition](../scripts/edition.mjs) | 参照/kind/出典/日付/版の検証、記事published≦号published、legacyを朝刊と推測しない |
| [production](../scripts/production.mjs)、[daily guard](../scripts/daily-pr.mjs) | editionDigestは号＋参照記事の全metadata/本文＋対象価格。assertStableEditions。dailyは当該版の記事/号追加と価格追記のみ |
| [build](../scripts/build.mjs)、public/assets、既存testとworkflow | 静的記事/号/検索/RSS/sitemap、共通天気、同日版切替、モバイル下端ナビ。記事本文は安全なMarkdown subset |
| [一次資料registry](../config/research-sources.json)、source-research/autonomous | 許可host/path・本文snapshot/digest。OpenAI入口はnews、Xはshadow unavailable |

Issue #15の本文/コメントと関連PR #1/#2/#3（契約・trusted guard・公開証明）、#8/#9（版/digest）、#11/#12/#13（朝夕導線・モバイル）、#14/#17（当日の号）、#16（shadow）を確認した。機能Issueは#15のみでシリーズ専用Issueはなかったため#18へ分離した。**#16/#17は取得時点でmerged**。#15と#16本文に残る「PR未merge」は履歴として扱い、現在の実装状態を上書きしない。本番自動引き渡し/merge/通知が接続済みであるとは判断しない。

この設計PRはdocsとREADMEの案内だけを変更する。contracts/scripts/workflow/public/content/dataは変更しない。とくにeditorial-policyはbuildで公開されるため、本PRでは編集しない。公開記事・価格・既存digest・本番UIに変更を加えない。

## 2. シリーズの範囲と意味判断

シリーズは「同じ主体」だけでなく、**同一の追跡対象と、その連続する変化**を共有する記事の列。既存タグ/注目テーマとは別物であり、OpenAIのすべての記事を束ねるものではない。

| 判断 | 必要な根拠 | 例 |
| --- | --- | --- |
| existing-update | 同一企画/incident/製品型番/法案番号/リリース系統。直前の状態から新たな変更がある。対象地域・提供範囲・版も一致 | 障害ID Aの発生→復旧→原因報告 |
| new-series | 識別可能な新しい追跡対象と継続の根拠。明示された連日企画、発売予定、審議段階、未解決incident等 | 新製品の発表→発売→実測レビュー |
| related-only | 企業/技術/関心は共通だが、同じ変化の列とは説明できない | OpenAIの広告と別件のモデル高速化 |
| none / needs-review | 続報根拠なし、複数シリーズが競合、対象/日付が曖昧、原典不足 | 同名製品の別地域版、別の障害ID |

LLMは上記decision、理由、対象scope、比較した既存候補、除外理由、今回の新規性、原典の該当箇所を出す。候補検索はcanonicalTopic/entitiesに加え対象ID・地域・版・時間・本文を利用する。最も似た1件だけに絞らず、競合する候補と「関連に留める」を比較する。confidenceは補助情報で、閾値単独の自動承認はしない。

企業名/タグ一致、単に隣接する日付、同じURL、似たタイトルは結合の十分条件にならない。LLMの既存ID候補はtrusted baseのregistryに存在するものだけ。新規IDは正規化したslug案として提出し、人間がscope・重複・ID衝突を確認して登録する。IDをタイトル変更で変えない。v1のguarded段階は**レビュー済み既存activeシリーズへの付与のみ**で、新規シリーズの自動作成は対象外。

一般化する粒度は、VRChatなら特定のリリース/機能展開、Meta/Valveなら製品世代または更新キャンペーン、法制度なら法案/法令番号と管轄、障害ならサービスとincident ID。無期限の「VRChatの全更新」は注目テーマで扱う。長い空白期間だけで自動終了しないが、前回との同一性を再確認する。

## 3. 採用するseries contract

### 保存場所と後方互換性

将来の専用schemaを `contracts/series.schema.json`、正本データを **`data/series/<id>.json`（1シリーズ1ファイル）** とする。定義とmembersを同じファイルに置き、横断集計はbuild時に行う。現行front matterへseriesを追加すると未知キーとして拒否され、既刊digestも変わるため、**v1では記事にseriesフィールドを追加しない**。sidecarでarticle slugへ結び付ける。

seriesファイルなし・membershipなしの既存記事は、現状の表示・URL・status・本文・digestを維持する。未知/不正なseriesデータは黙って無視せずvalidator/buildを失敗させる。全記事をseriesへ移行する必要はない。記事のpublished/edition/kind/statusは既存記事と号を参照し、sidecarに二重保存しない。

### 定義

| フィールド | v1の規則 |
| --- | --- |
| version | 専用contractの`1`。publishing/autonomousのversionとは独立 |
| id / title | idは`^[a-z0-9]+(?:-[a-z0-9]+)*$`、ファイル名と完全一致、全体一意・永続。titleは表示名 |
| canonicalTopic | topicの安定keyと短いscope説明。企業名だけのscopeは禁止する編集判断 |
| entities | `{type, key, label}`の重複なし配列。typeはorganization/product/campaign/incident/legislation/project。keyは安定した識別子。地域/型番/法案番号はscopeに含める |
| status | `active / paused / completed / discontinued`。記事の確認状態statusとは別 |
| expectedCount? | 発表側の予定milestone数（正の整数）。記事数ではない。28日企画なら28。根拠なしには設定しない |
| startedAt? / expectedEndAt? / endedAt? | 確認した開始、予定終了、実際の終了のJST日時。予定と実績を分離。eventの日時であり記事publishedとは別。未確定なら省略 |
| coverage | `{mode: complete-from-start / partial, note}`。途中登録/未掲載milestoneがある場合はpartial。完全性の意味判断はレビュー |
| parentSeriesId? | 派生シリーズ1つの親。自己参照・不在・循環禁止。前後ナビは親子をまたがない |
| revision / updatedAt / changeNote | 人間レビューの定義変更・再編成単位。revisionは1から増加。通常の日刊members末尾追加では変更しない。履歴はGit/PRに残す |
| members | sequence昇順の配列。新規登録時のみ空配列可。空シリーズは公開一覧に出さない |

endedAtはcompleted/discontinuedで必須、active/pausedでは禁止。存在する日時は実在JSTでstartedAt≦expectedEndAt/endedAt。expectedEndAtの超過だけでcompletedにはしない。終了後の記事は通常appendできず、終了後総括/訂正が必要なら別レビューPRで根拠と扱いを決める。

### 記事membership

| フィールド | v1の規則 |
| --- | --- |
| article | 実在する公開対象newsのslug。v1では1記事1primaryシリーズ。単なる関連は所属にしない |
| sequence | 正の安全な整数。**そのシリーズ内のJAMIO掲載順**。1〜N連続、一意。発表側のDay番号とは別 |
| relation | `start / update / correction`。sequence=1だけstart、以降はupdate/correction。startは当サイトでの追跡開始で、企画の初日とは限らない |
| updateType | announcement/rollout/release/review/outage/recovery/postmortem/deliberation/enactment/effective/other。relationとは独立した出来事の種別 |
| eventKey | 同一シリーズ内の新規イベント識別key。重複禁止。対象ID＋milestone/変更識別子等の根拠付きkey。URL一致だけでは同イベントを証明しない |
| milestone? | `{ordinal?, label}`。ordinalは正整数、labelは「Day 2」「施行」等。複数の記事が同じmilestoneを扱える |
| delta? | sequence>1は`{summary}`を必須とし、直前sequenceとの差分を1〜2文で保存（160 Unicode code point以内）。sequence=1には持たせない。比較先は導出 |
| correctsArticle? | relation=correctionのときだけ必須。自分より前の同シリーズ記事。前後ナビとは別の訂正対象 |

任意キー・型違い・空白だけの文字列を拒否する。previous/next/URLは入力として受け付けない。milestone.ordinal≦expectedCountを検証できるが、同ordinalを複数記事で扱うためuniqueにはしない。ordinalの逆行は普通のappendでは停止し、遅れて確認したmilestone/訂正は別レビューへ送る。eventKeyの別表記による意味的重複はCIでは完全検出できない。

LLMの理由・引用全文・confidence・run情報はこの公開sidecarに混ぜず、detached proposal/evidenceに保存する。public側は読むための定義とmembership/差分だけ。seriesのexpectedCount/開始終了/scopeにも登録時の出典・レビュー根拠を残す。

## 4. 明示sequenceと時刻順の比較・採用理由

| 方式 | 長所 | 問題 |
| --- | --- | --- |
| publishedから毎回sequenceを導出 | 入力が少なく、時系列との一致が自然 | 現行記事は同一時刻が多い。意味順がslug任せになり、後付けで表示番号が暗黙に変わる。Day番号と混同しやすい |
| 明示sequenceを保存 | 同時刻の意味順をレビュー可能。重複/欠番/前後関係を確定し、staleな並行付与を拒否できる | 付番・後付け・並行更新の検証が必要 |

**明示sequenceを採用**する。決定論的controllerがtrusted baseの最終値から付番し、LLMの希望番号を採用しない。公開順はsequenceで、日付は整合検証に使う。通常追加は既存membersの不変prefix＋N+1…の末尾追加に限定する。

同じシリーズでarticle.publishedはsequence順に非減少。号のpublishedも非減少とする。同日朝刊→夕刊もこの実時刻順であり、版名で強制的に並べ替えない。legacyを朝刊として序列化しない。

新しい同一パッケージ内で同時刻なら、(1)明確な依存/意味順があればLLMの理由付き順序をレビュー、(2)なければ号published→号slug→記事slugの昇順をcontrollerの決定的な提案順とする。検証では同時刻に異なるsequenceを許す。同じ日刊PRの複数記事を複数番号として原子的に検証する。既存prefixと同時刻の新規記事も末尾へ置き、既刊の順をslugで並べ直さない。

source/eventの発生日時、取得日時、記事publishedを混同しない。通常のナビは掲載順。遅れて報じる過去イベントは本文/シリーズ一覧で発生日と掲載日を区別し、shadowのfresh-event条件を緩めて自動で通さない。

previous/nextは検証済みmembersの隣接要素から生成する。timestampで再付番しない。先頭/末尾は不在リンクを作らず「前の記事なし」「次の記事は未掲載」。next方向だけを辿ったときに終端へ到達し、導出previousがその逆辺と一致することをテストする。正常な前/次の往復を循環エラーとはしない。

## 5. 欠番・後付け・ライフサイクル・訂正

| 状況 | 採用ルール |
| --- | --- |
| sequence欠番 | **許さない**。1,2,4はエラー。欠番placeholderや未刊行記事へのリンクを作らない |
| 発表側Dayの欠落 | 許す。sequence=3がDay 5でもよい。coverage=partialと欠落理由を明示し、一覧で「Day 3/4は未掲載」と表示。未発表と未掲載を断定で混同しない |
| 途中から登録 | 最初に掲載するDay 7がsequence=1、relation=start、milestone.ordinal=7、coverage=partial。「当サイトの追跡開始」と示す |
| 過去記事のretroactive linking | sidecarだけを別レビューPRで追加。news/所属号/published検証、全既刊digest不変。後付けの事実はchangeNote/Git/PRに残す |
| 途中挿入/誤結合の解除/統合 | 日刊自動appendで行わない。レビューしたmaintenance PRでrevisionを上げ、members全体を掲載順に再付番し、旧→新番号対応と影響一覧をPRに記す。delta/訂正参照を再評価する |
| 安定性 | 永続リンクはarticle slug/series ID。sequenceは**そのrevision内で**固定。URLや通知キーをsequenceだけで作らない。後付けで番号が変わり得る旨を一覧に示す |
| 終了/中断 | 人間レビューでactive→paused/completed/discontinued。予定日超過・expectedCount件掲載だけで終了扱いしない |
| 再開 | 同一scopeの再開は別PRでactiveへ戻し、endedAtを外して履歴/理由を残す。sequenceを継続し1へ戻さない。別キャンペーン/別incidentなら新ID |
| 発表者による企画リセット | 掲載sequenceをリセットしない。新しい周回は新ID＋parentSeriesIdで区別し、人間登録。expectedCount/Dayはその周回に属する |
| 枝分かれ | 独立したscopeに新ID＋parentSeriesId。親/子それぞれ直線ナビ、一覧に派生リンク。v1は複数primary所属・任意のDAGを扱わない |
| 既存記事の訂正 | 現行updated/corrections付き別レビューPR。本文訂正は元号digestを変えるため、通常日刊や本設計のdigest不変枠では行わない。sequenceは動かさない |
| 独立した訂正ニュース | 新しい記事として末尾へrelation=correction、correctsArticleを付ける。過去号の参照/本文を自動変更しない。誤報の危険な残存は人間へ即時エスカレーション |

coverage=complete-from-startも企画の全ニュースを保証する自動証明ではない。欠落発見時はpartialへレビュー変更。milestoneがない障害/法制度/製品では「Day」連番の完全性を要求しない。シリーズ編集の取り消しはレビュー済み復旧PRで行い、旧記事/号を削除しない。

## 6. UI・アクセシビリティ・モバイル

- 記事タイトル付近にシリーズ名＋milestone（あれば）を小さく表示。本文末尾に `<nav aria-label="このニュースシリーズ">` で「← 前の記事: タイトル」「シリーズ一覧」「次の記事: タイトル →」。記事/号の前後ナビとは名称を区別する。
- リンクは通常の静的a要素。JavaScriptなしでも往復できる。自動リダイレクト、スワイプ必須、色/矢印だけの識別を避ける。不在の前/次は非リンクの説明とし、href="#"を使わない。
- `/series/` はactive/paused/completed/discontinuedと最近の掲載日で一覧、`/series/<id>/` はscope・対象・掲載範囲・状態・予定/実績・全記事の昇順olを表示。現在の記事位置はaria-currentで示す。article statusは各項目に個別表示し、seriesへ一括verifiedバッジを付けない。
- 予定28回と掲載2本は「予定milestone 28 / 当サイト掲載2記事」と区別。欠けたDayは文章で説明し、未刊行のリンクを作らない。長大シリーズもv1は静的全件一覧で検索/ページ内移動可能とする。
- 320/375/390/430pxとPC、dark mode、200%ズーム、キーボード/フォーカス、読み上げ順、JS無効を確認。最低44pxの操作領域、タイトル折返し、横はみ出しなし。既存下端ナビ/safe-areaと重ならない。既存の要約2行制限で差分が切れないよう別行に置く。
- 既刊号のシリーズ表示は「現在の追跡ナビ」と示す。後日のnext追加で古い号のナビは更新されるが、元の紙面本文・記事summary・Top 5・digestは変えない。

## 7. 朝刊/夕刊Top 5の差分と重複感

差分は「前回: X / 今回: Y」または「続報: Y（前回からの変更）」を1〜2文で表示し、比較先記事と一覧へ通常リンクを置く。比較先は同シリーズの直前sequenceで固定し、朝刊か夕刊かに依存しない。同じ号に2記事があれば2本目は1本目との差分。coverage=partialなら「前回掲載」と呼び、未掲載のDayを前回と誤認させない。

delta.summaryは原稿からLLMが提案し、人間/証拠評価が裏付ける。CIは長さ・前回参照の存在・証拠bindingを検証するが、意味的な差分の正しさは保証できない。後付けで比較先が変わる場合はsummaryも再レビューする。記事summary/本文をUI都合で上書きせず、differenceはsidecarの現在の補助表示に留める。

既報の言い換えは新規Top 5にしない。新たな提供範囲、価格、利用枠、状態の転換、意思決定への影響がある続報を通常の重要性基準で選ぶ。同じseriesだから必ず毎号採用しない。原則として同号では一つにまとめ、別々に読む価値のある重要更新だけ複数掲載し理由をevidenceに残す。企業が同じでも別シリーズは独立評価する。今日の重要ニュースから既刊を消さない。

連日企画は調査時の追跡候補リストに載せ、未取得/新しい発表なし/掲載見送りを内部reportに記録する。全Dayを確認することと全Dayを記事化することを分離する。朝刊5本、夕刊1〜5本、旧記事を別号Top 5として使い回さない現行契約は維持する。重要続報がなければ夕刊は発行しない。

## 8. LLM提案とdeterministic validatorの境界

将来のproposal schemaは専用のdetached契約とし、現行autonomous.schemaへ未知キーを混ぜない。全候補にdecisionを付け、positiveだけでなくrelated/none/needs-reviewもshadow評価に残す。

proposalはversion、runId/attempt/date/slug/baseSha/windowStart、registryDigest、reportDigest、packageDigest、article、decision、candidateSeriesIds、selectedSeriesId（existingの場合）、scope理由、除外理由、newEvent根拠、updateType/milestone/delta案、前回article/digest、source URL/snapshot digest/該当excerptを含む。new-seriesは定義案を含み、公開/登録の承認とは扱わない。引用は取得本文への一致と本文digestを検証する。元記事の過去出典と今回の追加事実の出典を分ける。

| 検証 | 停止する条件 |
| --- | --- |
| schema/ID | 未知キー、不正slug、id≠ファイル名、重複ID、参照先不在、IDの改名/再利用 |
| sequence/order | 重複・欠番・逆転・記事または号publishedの逆行、手入力previous/next、導出隣接の不一致 |
| membership | 不在記事、同記事の複数primary、guide/editorial、当該号articles不一致、slug/date/variantの矛盾、未刊行草稿への参照 |
| event/lifecycle | eventKey重複、期待数超過、通常appendのmilestone逆行、inactiveへのappend、矛盾する終了日時、自己訂正/未来の訂正対象 |
| graph | parent不在/自己参照/親子循環、correctsArticleが同シリーズの先行記事でない。直線ナビ以外の辺を前後リンクとして使わない |
| delta/evidence | startのdelta、続報のdelta欠落、前回slug/digest不一致、引用不一致、未取得source、snapshot改変、別記事のevidence使い回し |
| publication scope | 日刊の定義変更/既存members変更/過去記事追加/無関係ファイル、非通常ファイル、既刊記事/号/価格prefix/digest変更 |
| stale/concurrency | registry/source/package/base/head/run/attempt/lease不一致、main前進、同seriesへの同sequence並行追加 |

ID/参照/時刻/構造の整合はコードの責任。企画の同一性、誤結合、語義上の新規性、引用が主張を支持するか、事件名の別名、重要度、誤ったeventKeyの付番は編集判断であり、CI greenで証明できない。LLMのconfidenceが高くても曖昧ならneeds-review。

shadowの昇格評価では、同企業別件・似た製品名・別地域・同URL更新・欠落Day・長期空白・訂正・分岐・並行朝夕を含むfixtureを用意。人間の正解ラベルと比較し誤結合/見落とし/重複、差分の正確さ、needs-review率を記録する。最低7連続日のshadow＋境界fixtureをレビューし、誤結合0件・すべての採用差分に根拠・未解決の重大な見落としなしを昇格の必要条件とする。将来の正しさの保証ではなく、失敗時は原因修正後に評価期間をやり直す。

## 9. Autonomous Publication v1への組込み

### Shadow（公開権限なし）

1. 元run時刻の日付・baseSha・attemptを固定し、trusted registryと全既刊digestをsnapshotする。記事候補にseries判断を加えるが、既存の収集/生成/評価接続ができたと仮定しない。
2. 既存記事/series候補はbaseから読む。今回は取得した追加原典と既刊本文を比較し、detached proposalを別artifactに保存。草稿は現行`articles/,edition.md,prices.json`の3要素のまま。series案をfront matter/草稿ファイルに混入させない。
3. 既存publishing/原典evidence評価の後、専用validatorで仮想sidecarを評価。原稿とseries評価を別statusで報告し、合格してもpublicationAuthorized=false。series不適合を既存evaluator成功で打ち消さない。
4. 出力は判定・比較・停止理由・誤結合評価まで。source本文をログに無制限転載せず、現行artifactの14日保持を出版証拠の永続保存と誤認しない。保存期限後/古いrunは再評価する。

**現行制約:** autonomous schema/contextはmorning限定・stories5〜10件、既刊で使ったeventUrl再利用禁止・windowStart以後のeventAtを要求する。同じrelease notes/status URLの新しいsnapshotや過去記事をseries目的で流すことは、今のevaluatorでは通らない。この設計だけで条件を緩めない。夕刊shadowとmutable URLの新イベント識別は別基盤PRが必要。後者ではcanonical event identity、snapshot差分、locator/更新日時、新規主張引用、既刊との意味比較を設計・試験してから既存fresh-eventゲートを変更する。取得URLが同じという理由でsource検証を迂回しない。

Xだけの発見は現行編集方針を維持し、verifiedにはX以外の一次資料が必要。series登録はX接続も本人性も解決しない。責任者発信/公式フォーラム等のhigh-signal discoveryは有効な別テーマだが、allowlistやcollector変更は別レビューPRで行う。取れない原典は取れないと記録する。

### Guarded付与（#15の本番ゲート達成後）

現行daily guardは`data/series`変更をすべて拒否する。**先に基盤PRでtrusted mainのguardを拡張・マージし、その後の日刊で使う**。候補PRのスクリプト実行や一般的なJSON書換え許可で回避しない。

- baseに登録済みactiveシリーズだけ。当該版の新規news記事へのmembers末尾追加だけを許可。定義/id/status/revision/coverage/日時/expectedCount/parentおよび既存membersはcanonicalで完全一致。新規ファイル、過去記事付与、既存membership訂正、削除/rename/symlink/実行modeは拒否する。
- 同一号で複数シリーズ/複数membersを扱っても全件一括検証。当該号articlesに含まれないarticleは拒否。添付しない記事も通常のpublishing契約を満たす。書式変更だけのJSON書換えも拒否。
- publisher controllerがsequence/eventKey/引用bindingを固定し、信頼済みCIが独立再計算。base registryDigestとpackage/report/proposalのdigest、認証済みcollector run/artifact/最新attempt/leaseとheadを結び付ける。候補sidecarに書かれた自己申告のevidenceだけでは承認しない。
- 同時制作はbaseSha＋series digestをcompare-and-swap相当で検査。先のPRがmergeされたら後の付番/evidence/差分はstale。最新mainを取り込みN+1と比較先を再評価してCIを再実行する。既存番号の上書き・force pushで衝突を解消しない。
- シリーズ提案なしは通常記事として進められる。positive提案が不適合/needs-reviewなら自動付与を停止し、必要な人間判断を報告。記事だけ公開する場合はseries案を外した**新しいimmutable packageと証拠**を再検証し、失敗したheadをそのままmergeしない。
- #15のmain保護/required CI、認証済み引渡し、writer/merger分離、exact head/base、expected-head merge、Pages/receipt/outboxゲートをすべて維持。series CIを追加必須にする。本PRは本番有効化/設定変更を行わない。

新規シリーズ/終了/再開/coverage変更/後付けはmaintenance PRで人間承認する。日刊とは別branchであるだけでは安全性を保証しないので、同じvalidator・digest/ナビ公開証明と必須レビューを要求する。既存articleの内容訂正はさらに現行の訂正手順へ分離する。

## 10. digestと公開証明

現在のeditionDigestの入力・意味・contractVersion=1を変更しない。sidecarを記事オブジェクトへ破壊的にmergeしてからeditionDigestを計算すると既刊digestが変わるため、**記事/号の正本とderived series viewは分離**する。各基盤/シリーズPRで全既刊号のdigest比較を実施する。

シリーズは読み方を変える公開データなので、edition digestの外だから無検証とはしない。表示段階のPRから別の公開証明を実装する。将来の`series-publication.json`はversion=1/commit/registryDigestと各id/revision/url/navigationDigestを持つ。registryDigestはid昇順の全sidecarをcanonical化したSHA256。navigationDigestはそのseries定義/membersと参照記事のslug/title/published/status、所属号identity/URL、導出previous/next/記事URLを含む正規化viewのSHA256とする。既存JSONキー整列とLF正規化を再利用する。

記事ナビ/シリーズ一覧HTMLに対応navigationDigest、一覧indexにregistryDigestを埋め込み、trusted mainの公開確認が**exact merged main SHAのPages成功＋別manifest＋生成HTMLのリンク/metadata**を照合する。既存publication.json/号HTMLのcanonical/digestの照合も必須。既存JAMIO_PUBLIC_RECEIPTの代わりにseries receiptだけを使わず、別のseries用receiptを追加する。API-only経路もそのexact main runの検証済みログに限定する。

後日の記事追加で過去記事のnext/一覧が更新され、navigationDigestは変わり得るが、既刊edition digestは不変。これは紙面内容と現在のナビの別証明であり、旧receiptが新しいseries表示を証明するとは扱わない。確認不一致では付与成功/通知を主張しない。UIだけのCSS修正等は既存Pages CIとvisual QAも必要で、これらの内容digestは全HTMLバイトの証明ではない。

## 11. OpenAI 28 Daysの具体例

以下は**参照会話にあるDay 1/2の主張を使った仮想構造例**。本設計作業では、その発表・人物・高速化率・適用範囲・無料化・開始日を原典で再検証していない。記事化/series登録時に確認し、X単独でverifiedにしない。現行mainにDay 1/2記事はないため、本PRで実記事へリンクしない。日付は朝夕同日を説明するための例であり、実発表日ではない。

```json
{
  "version": 1,
  "id": "openai-28-days-2026",
  "title": "OpenAI 28 Days",
  "canonicalTopic": {"key": "openai-28-days-2026", "scope": "特定の28日連続改善企画の同一周回"},
  "entities": [
    {"type": "organization", "key": "openai", "label": "OpenAI"},
    {"type": "campaign", "key": "openai-28-days-2026", "label": "28 Days"}
  ],
  "status": "active",
  "expectedCount": 28,
  "coverage": {"mode": "complete-from-start", "note": "Day 1から追跡する仮想例"},
  "revision": 1,
  "updatedAt": "2026-10-06T06:00:00+09:00",
  "changeNote": "原典確認・人間登録後に使用する構造例",
  "members": [
    {
      "article": "2026-10-06-morning-openai-28-days-day1",
      "sequence": 1,
      "relation": "start",
      "updateType": "rollout",
      "eventKey": "openai-28-days-2026:day1:default-speed",
      "milestone": {"ordinal": 1, "label": "Day 1"}
    },
    {
      "article": "2026-10-06-evening-openai-28-days-day2",
      "sequence": 2,
      "relation": "update",
      "updateType": "rollout",
      "eventKey": "openai-28-days-2026:day2:auto-review",
      "milestone": {"ordinal": 2, "label": "Day 2"},
      "delta": {"summary": "前回の標準速度改善に続き、今回はAuto-review無料化の発表。対象・適用条件は原典確認後に記載する。"}
    }
  ]
}
```

仮にDay 1記事published=06:30、朝刊published=07:00、Day 2記事=16:50、夕刊=17:00なら、sequence=1→2を検証できる。Day 1の「標準速度約50%改善」とDay 2の「Auto-review無料化」は別eventとして原典の発信者/発表日時/対象プラン/実際の提供状況を証拠にする。会話の要約だけではその証拠を満たさない。

Day 1ページは一覧/次Day 2、Day 2は前Day 1/一覧。将来Day Nが初めて掲載された3本目なら、**sequence=3・milestone.ordinal=N**。Day 2のnextは掲載済みDay Nへ。N>3ならcoverageはpartialへ人間レビューで変更し、欠落Dayの未掲載を示す（通常の日刊appendにcoverage変更を混ぜない）。全Dayを1本ずつ掲載した場合だけsequence=Nとなる。

Day 2に別の重要な追加発表を同日掲載したら、sequence=3・milestone.ordinal=2も可能。次の日Day 3はsequence=4。Day番号の重複は許すがeventKey/記事の重複は拒否する。28日終了は実際の終了の確認でstatus=completed/endedAtへ変更し、28記事という件数だけでは完了にしない。

朝刊/夕刊Top 5は「Day 2: Auto-review無料化。前回掲載の速度改善からの続報」と比較先を表示する。重要性不足なら記事化しない。モデル高速化、プラン/利用枠、Codex/Work、agent機能などは現行の関心・影響基準で評価する。OpenAI DevDay・広告・ウォーターマーク記事を、同社という理由だけでこのseriesへ後付けしない。

## 12. 段階導入・受入条件・次のPR

| 段階 | PRの範囲 | 受入条件 |
| --- | --- | --- |
| 0 設計（今回） | 本書、README/運用docsの参照、#18と#15の接続 | 現行仕様の監査、設計決定/例/非目標/境界が記載され、docs以外の差分なし、全既刊digest不変。mergeは別レビュー |
| 1 表示のみ | series schema/validator、レビュー済みsidecar、静的ナビ/一覧、別navigation manifest/receipt | 未指定記事互換、序列/欠番/参照/kind/edition/循環チェック、legacy URL/digest固定、JSなし/モバイル/keyboard QA、exact main公開証明。daily guardはまだ拒否 |
| 2 LLM提案shadow | detached proposal/evidence、registry snapshot/read-only評価、日々の品質記録 | 現行朝刊shadowの条件を維持、誤結合評価7日＋境界fixture、snapshot/run/attempt/base/package binding、公開/branch/merge/通知writeなし |
| 3 guarded自動付与 | activeシリーズへの末尾追加guard、controller証拠検証、required CI/並行制御 | #15全本番ゲート＋series専用証拠/receipt、定義・prefix・既刊不変、same-series競合/stale/偽evidence拒否、原子的再検証。運用有効化は独立レビュー |

段階1はschema/validator/receiptを先に小さく実装し、その上に表示PRを分けてもよい。人手登録データは基盤がmainに入ってから別PRで作る。仮想OpenAI記事をfixture以外に生成しない。段階2の夕刊shadow・同URL更新イベント、high-signal discoveryはそれぞれ既存evaluator/collectorを見直す独立候補PRとする。段階3はそれらが未実装のケースを自動承認範囲へ入れない。

意味のある回帰fixture: 同日朝夕/同時刻の2記事、1/2/4拒否、Day1/2/5許容、途中Day7、retroactive挿入とrevision、同企業別件、inactive append、親子/訂正循環、guide/別版混入、旧記事metadataへの混入、stale registry/base/head/attempt、同sequenceの並行PR、既存prefix改変、偽artifact、変更されたdelta比較先、series receiptとedition receiptの不一致。

### 非目標と将来利用

今回の本番UI/contract変更、日刊記事/価格制作、予定タスク変更、追加LLM API課金、X制限回避、verified基準変更、無条件の新規series自動登録、自動merge/通知、全記事への強制分類、任意関連グラフ/多重primary、検索基盤の全面刷新は行わない。

将来はsearch.jsonへoptional series ID/title/milestone/statusをderived属性として追加し、シリーズ絞り込み・カテゴリ横断検索に使う。記事URL/RSS guid/publishedは保持し、後付けだけで新記事としてRSS再配信しない。アーカイブに日付/版を維持したままseriesへの入口を加え、一覧/完結シリーズの振り返りへつなぐ。

シリーズ購読/通知は#15のdurable outbox/receiptの後の別機能。既存送信先＋edition-slug＋digestの重複キーを置き換えない。series通知を追加するなら送信先＋series ID＋article slug＋eventKeyで別台帳を設計し、metadata後付け/番号変更だけでは再通知しない。通知unknown時は自動再送しない。追跡対象/通知先の追加は本設計によって暗黙に有効化されない。
