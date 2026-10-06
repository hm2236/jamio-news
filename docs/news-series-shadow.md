# ニュースシリーズ段階2 — detached proposal shadow

追跡: [Issue #18](https://github.com/hm2236/jamio-news/issues/18)。初期実装の基準mainは`cd211e5c106012a7d7588d742b3c9cafe6ff425e`。canonical topicのblocker修正時（2026-10-07 JST）にGitHubから再取得したmainは`6f528ae3d06bb1b479ec4bae45a0ee212da9e25f`、AGENTS.mdなし、production registryは空と確認した。段階1の表示・receiptと全4既刊digestを維持する。段階2はread-onlyの提案・評価基盤で、**7連続日の実運用評価はまだ未達成**。guarded付与は未導入。

## 公開との境界

LLM/編集者の出力は `contracts/series-proposal.schema.json` に従う独立JSON。草稿は従来どおり `articles/, edition.md, prices.json` の3要素で、proposalを混ぜない。`data/series/`、記事front matter、既刊、公開registry、daily guard、Pages、merge/publish権限へ書き込まない。build/series validatorはproposalを読まない。`proposal-valid` / `shadow-ready` は登録・公開を意味しない。

`scripts/series-shadow.mjs` の出力先はGit管理対象外の `series-shadow-output/` 配下だけ。排他的作成で上書き拒否、path traversal・symlink/junction・公開パスを拒否する。source本文とLLM理由はartifact内だけ、ログ/summaryには件数と状態だけを出す。新しいLLM API、secret、依存パッケージ、予定タスクは追加しない。

## 入力・証拠binding

`prepare` はtrusted mainの朝刊reportから、registry snapshot・全既刊news本文/出典/記事digest・取得snapshotを独立inputへ固定する。各snapshotの許可publisher/redirect先/type/category、literal本文digest、同日かつrun開始以後のcheckedを検証する。既刊号digestも照合。source registryは `config/research-sources.json` のcanonical SHA256、公開registryは段階1のLF正規化/id順registryDigestを使う。

proposal envelopeのbindingは次のすべてを固定する。

- Autonomous v1のcontext全項目: runId / attempt / original startedAt / JST date / morning slug / baseSha / windowStart。
- 元GitHub runのcreated_atをUTCで記録するrunCreatedAt。read-onlyなのでheadSha=baseSha。
- inputDigest / registryDigest / sourceRegistryDigest / snapshotsDigest / corpusDigest / reportDigest。
- packageDigest=`sha256(canonical(readDraft(folder)))`、evidenceDigest=`sha256(canonical(autonomous evidence))`。
- proposalDigest=`sha256(canonical(submission))`を**別引数で受信側がpin**し、evaluationへ記録。LLM JSON内の自己申告digestを信頼しない。

hash/canonicalはAutonomous v1の方式。input/proposal/evidenceを改変・自己再hashしてもpin済みreceiptとの一致が必要。digestは署名/認証ではない。元artifactを認証済みGitHub Actions経路で取得した証拠と、受信時のpinを保管する。trusted collector/producerの認証・lease・必須CIへの昇格は #15 の本番ゲートであり、自己申告JSONだけで刊行許可にはならない。

`evaluate` は開始/終了にGitHubをGETし、元workflow・main・最新attempt・exact checkout HEAD/baseを再確認する。元created_atから日付を固定し、翌日retry、2時間超、main前進、attempt差し替えを停止する。評価直前にinputを再計算し、registry/source/report/既刊変更を拒否する。既存 `evaluateDraft` を最初に実行し、morning限定、5〜10記事、一次資料、fresh eventUrl、全既刊digest、X unavailable、価格観測なし、原稿品質構造の条件をすべて継承する。既存朝刊のあるrunは `ineligible-morning`、series目的の再制作はしない。

## 提案の意味と機械検査

各記事について `existing-update / new-series / related-only / none / needs-review` を保存する。部分proposalも観測可能だがcoverage<1は7日評価の合格対象外。

- candidateSeriesId: existingはbase registryに存在するactiveかつ既刊memberのあるseriesのみ。new-seriesは未登録slug案で、登録権限を与えない。paused/completed/空series/競合はneeds-review。negative decisionのIDは空または既存ID。
- identity: canonical topic/key/scope、entities、region、productVersion、incidentId、campaignId。positiveはregionと企業以外の追跡anchor必須。製品はversion必須。incident/campaign IDはentity keyと一致。globalも明示的なregion値として原典に根拠が必要。不明値は空としpositiveへ進めない。
- canonicalTopic.key / scopeは編集側の正規化値であり、原典・既刊claim中のliteral完全一致を要求しない。existing-updateではtrusted registryのcanonicalTopicと完全一致させる。new-seriesでは未登録の正規化案として、追跡対象とscopeが引用に支えられるかを人手レビューする。proposal-validは意味的正しさや登録の承認ではない。
- identityEvidence: positiveのentity表示名（label）と、空でないregion / productVersion / incidentId / campaignIdをliteral source excerptへ結び付ける。entityのfieldは`entity:<type>:<key>`、valueはlabel。keyは内部識別値でliteral不要だが、incident/campaignのkeyは対応IDと一致し、そのIDは別途literal必須。excerptは20〜600文字、取得本文に完全一致し、URL/type/checkedは当該朝刊記事のsource、sourceDigest/sourceRegistryDigestはinputと一致。canonicalTopicのfieldは含めない。
- comparedCandidates: 最有力だけでなく全base registryのseriesをmatch/excluded/ambiguousと除外理由付きで比較する。重複/不存在/欠落は拒否。複数match/ambiguousはneeds-review。
- comparedClaims: 全既刊newsのliteral本文excerpt・記事digest・same-target/excluded/ambiguousと理由を記録する。negativeも比較を省略しない。既刊claimの選択/除外は編集判断であり、人手ラベルで監査する。
- novelty: 新event/material update、原典で引用できるdelta、continuityReason。positiveのdeltaは当該朝刊fact evidenceにも引用される必要がある。existingは最新memberのpreviousArticle/claimとpreviousIdentityを比較し、同一topic/entity/region/version/incident/campaignを要求する。既報delta再掲・既存eventKeyは拒否。
- event: event key / URL /発生日時/updateType、milestone候補。URL/時刻は朝刊evidenceと一致。同じDayに別eventを許容し、Day 1/2/5の欠番はsequenceではない。milestone逆転/expectedCount超は拒否。proposal ID/article/event、同identity＋deltaの重複は拒否。
- confidenceは0〜1の補助情報だけ。値が高くても構造・引用・同一性・新規性の検査を免除しない。

引用の含意・翻訳・entity別名・eventKeyの意味・scopeの解釈・差分の重要性は機械検査だけで確定しない。異なる地域/版/incidentを同じ文字列へ誤って抽出するLLM誤りは、人手の誤結合評価が必要。既存続報は最新memberの既刊claimにも同じentity labelと実anchorのliteral根拠が必要。これらがない場合はneeds-reviewへ落とし、推測で埋めない。内部canonicalTopicやentity keyの文字列が原典・既刊にないだけでは拒否しない。

mutable URL本文更新、同URLを使った新incident、夕刊、遅れて判明したイベントは現行morning evaluatorの対象外。別の新鮮な原典URLが取得できなければ停止する。本実装はその制約を緩めない。

## Shadow artifactと実行手順

既存 `.github/workflows/autonomous-shadow.yml` に `prepare` と独立artifactを追加する。権限はcontents/actions/pull-requests readのみ、main限定、10分timeout、secretなし。branch/PR/merge/publish/notificationを実行しない。

- 既存artifact: `morning-shadow-<runId>-<attempt>`。
- series artifact: `series-proposal-evaluation-<runId>-<attempt>`（14日保持）。`input.json`、`evaluation.json`（awaiting-editorial/ineligible、全human metric未評価）、失敗時`failure.json`。
- job summary: 提案数、decision内訳、evidence failure、人手評価状態、**read-only / not registered / not published**。

Actions内でLLMを実行せず、既存編集制作者のartifact入出力も自動接続しない。したがってscheduled runの待機artifactは、実際のproposalや評価日を作ったことにならない。既存ChatGPT予定タスクから原稿/証拠/提案を自動受信できるかは、別途実runでの実証が必要。毎日人間が貼り付ける運用を自動連携の完成とは扱わない。

受信側は元run/attempt/baseの認証済みreportを読み、必要なら既存enrich CLIで具体的原典を取得する。**enrich後のreportでseries inputを作り直す**。source snapshot更新で以前のinputを使わない。trusted main checkoutで実行する。

```sh
node scripts/series-shadow.mjs prepare enriched-report.json series-shadow-output/RUN-ATTEMPT
# prepareはGitHubのmain workflow環境/run ID/attempt/SHAも要求する。
# proposalBinding(input, readDraft(folder), evidence)でbindingを作成する。
# 制作者の出力受信時にcanonical submission SHA256を別途pinして保管する。
node scripts/series-shadow.mjs evaluate input.json enriched-report.json drafts/YYYY-MM-DD-morning evidence.json submission.json PINNED_SHA256 series-shadow-output/RUN-ATTEMPT/record.json
```

evaluateの成功recordはinput/report/bundle/evidence/submission/evaluationを含むdetached replay package。エラーはfail closed、非ゼロ終了、sanitized summaryとfailure artifactを保存する。出力する評価recordとsource本文は公開サイトへ配布しない。artifactが保持期限を過ぎる前に、認証済み取得の証跡付きで7日分を保管する。

## 人手ラベル・7日集計

`contracts/series-labels.schema.json` に従いlabelを後付けし、recordの `labels` に保存する。version=1、evaluationDigest=`sha256(canonical(evaluation))`、reviewer、reviewedAt、itemsが必要。itemsは**全eligible記事**（proposal省略記事も含む）にarticle/expectedDecision/expectedSeriesId/duplicate/ambiguousを付ける。ラベルなしはunevaluated、部分ラベルはpartially-evaluated。0件を正解率100%にしない。

| 指標 | 定義 |
| --- | --- |
| proposalCount / decisions | proposal数、existing/new/related/none/needs-review内訳 |
| falseMerge | actual existing-updateが人手のdecision/series IDと異なる記事数 |
| missedContinuation | 人手existing-updateに対し、proposal省略/別decision/別IDの件数 |
| duplicateProposal | validatorの構造重複検出、または人手の意味的重複ラベル |
| ambiguous | needs-review/機械的競合の件数。人手評価後は人手ambiguous件数を使用 |
| evidenceFailure | fail closedしたevaluationの件数。無ラベルrunは別途未評価 |
| coverage | proposed / eligible morning articles。sourceCoverage/取得失敗数も別記 |

records.jsonは対象windowのrecord配列。7日集計はGitHub workflow run一覧を最後までGETし、対象期間のschedule/manual runを**全件**照合する。同日に追加したdispatchも対象。各runの最新attempt、元created_at→JST date、head/base、status/conclusionを照合。現在のmainへ履歴を付け替えず、各runのexact base Git blobをscratchへ読み、原稿と証拠を再検証する。windowStartも元baseの直前daily号から再算出する。古いcodeを実行せず、現在のvalidatorで検証するため、source registry/契約の変更で互換性を失えば期間を再評価する。

```sh
# baseのGit objectsを取得したtrusted checkoutで実行。GET用tokenはread-only。
node scripts/series-shadow.mjs aggregate records.json START_JST_DATE END_JST_DATE series-shadow-output/aggregate.json
```

未実行日、対象run欠落、失敗run、未ラベル/部分ラベル、coverage不足があればsevenDayWindowComplete=false。stale attempt/base、偽run、record/claim/source/proposal改変は集計を停止する。集計中にrun/attemptが前進しても停止する。少なくとも7連続日を満たし、false merge/missed continuation/duplicate/ambiguous/evidence failureがすべて0のときだけqualityGateObserved=true。それでもstage3Authorized=falseで、登録/公開権限はない。

テストの7日分は合成fixtureで、実運用日として数えない。実運用ではpositive例、複数series競合、negative、欠測、source障害、stale/翌日retryを観測し、意味的根拠と失敗原因をレビューする。空registry/noneだけの7日では既存続報の精度を実証できない。実seriesの登録は根拠を揃えた別maintenance PRで人手承認する。

## Discovery Radarと段階3

[#20](https://github.com/hm2236/jamio-news/issues/20) の全観測entity/event台帳と公開sidecarは別のデータ。Radarの候補は将来、取得済み一次資料・既刊claimとの差分・同一追跡対象の根拠を持つdetached入力としてのみ接続する。entity一致だけではpositiveにしない。本PRはProposal A/B研究のcollector、契約、ランキングをproduction依存へ追加しない。mutable URL/夕刊/late discoveryは別設計を要する。

段階3の前には実7連続日の人手評価、誤結合0、全positive deltaの原典根拠、重大な見落とし/曖昧性の解消を確認する。加えて #15 のmain保護/required CI、collector/producer認証、lease、writer/merger分離、exact head/base・Pages/両receipt・durable outbox等の全本番ゲートを満たし、activeへのappend限定guardを別PRでレビューする。本基盤PRをmergeしても段階2の運用評価完了や段階3開始とは扱わない。
