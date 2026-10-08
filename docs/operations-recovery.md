# JAMIO NEWS 実運用復旧（人間承認・公開前レビュー）

追跡: [Issue #15](https://github.com/hm2236/jamio-news/issues/15)。2026-10-08 確認基準main: `137552438046ac6543c3a8e5bf164973f5f2baaf` （復旧PR #49 merge・Pages receipt成功）。このSHAは固定の作業対象ではない。**各操作の前にfresh main/headを再取得する。**

Benchmark #1 / PR #38/#39/#40/#43と比較条件は凍結し、#45は別件。2026-10-08に既存ChatGPT予定朝刊06:00/夕刊17:00 JSTタスクを**Draft PRまで・自動merge/公開禁止**として再有効化したが、無人writerの実成功は未実証。新タスクを重複作成しない。

## 現状の境界と未完了

| 項目 | 判定 |
| --- | --- |
| 公開サイト | 最新の実号は2026-10-06朝刊・夕刊。#49を含むmain Pages [run 37768359860](https://github.com/hm2236/jamio-news/actions/runs/37768359860)はpublic HTML/digest receipt成功。新号ではない。 |
| packet main混入防止 | [PR #49](https://github.com/hm2236/jamio-news/pull/49) merge済。非日刊PRの`recovery-packets/**` add/delete/renameはtrusted `daily-guard`拒否。[使い捨てPR #51](https://github.com/hm2236/jamio-news/pull/51)で実機拒否・未マージcloseを確認。 |
| 復旧プレビュー | このPR #46の`Trusted recovery preview (unpublished)`はmainにmergeされる**までは起動不可**。候補の静的CI成功を本番導入済みと誤認しない。 |
| 予定制作 | producer handoff / scheduled writer / merger / notifier / lease・outboxは別の未受入。朝刊first runと夕刊要否は実際のJST時刻と原典に依存。 |
| 本番保護 | main ruleset 24643329: PR必須、exact `build`/`daily-guard` strict required、通常mergeのみ、non-fast-forward・delete拒否。daily ruleset 24643660はforce push拒否。 |
| Radar/collector | collectorとRadarの遅延/劣化は原稿の一次ソースや出版証拠ではない。#27の長期acceptanceとは別。 |

## 1. 人間レビュー前の原稿作成

1. 原典を実際に開き、JST時刻・出典URL・タイトル・要約・本文を作る。朝刊は**ちょうど5件**。夕刊は重要更新がある場合だけ1–5件、見送り可能。
2. 現行`contracts/publishing.schema.json`および`production.mjs`契約を満たすbundleから、**fresh protected main SHA**固定のpacket JSONを作る。未来時刻、架空出典、埋め草、X未取得の偽記録、既刊記事の焼き直しは禁止。
3. 出版とは独立した`recovery/<purpose>` branch上で、以下のパス**1ファイル追加・1コミット・base=main**のみのDraft PRを作る。mainや`daily/`には置かない。既存の同日packet/daily PRやbranchを再確認し、衝突時は止める。

```json
{
  "version": 1,
  "baseSha": "<fresh main の40文字commit SHA>",
  "package": {
    "date": "YYYY-MM-DD",
    "edition": {},
    "articles": [],
    "priceObservations": []
  }
}
```

packet名: `recovery-packets/YYYY-MM-DD-morning.json` または `recovery-packets/YYYY-MM-DD-evening.json`。1MiB以下、regular Git blob(100644)。空欄は説明用で、実際のbundleではない。公開リポジトリへ非公開文書・個人情報・鍵を送らない。

## 2. 信頼済みmainのプレビューだけを受け付ける

**このPR #46を通常の独立レビューとmain承認を経てmergeした後**、`.github/workflows/trusted-recovery-preview.yml` が **`pull_request_target`** / `recovery-packets/**` を処理する。

- 使う実行コード・schema・rendererは**exact protected main**からのみcheckoutし、PR headのcode/workflow/actionをcheckoutも実行もしない。同一repo/`main`へのopen recovery PR限定。fork、別base、stale/main headや失効日付は拒否。
- headは`git show <exact-head>:<packet>` の単一JSON**データ**として読む。baseから単一親commit・新規packet1ファイルのみ・100644・サイズ上限・base/slug一致を確認。コード変更/複数commit/rename/symlink/削除は禁止。
- 描画jobは`contents: read`と`pull-requests: read`だけの`GITHUB_TOKEN`をAPI読み取りに使用。OIDC/書込権限なし、`persist-credentials:false`。build子プロセスはOS必須変数とexact `GITHUB_SHA`だけを受け取り、token・OIDC・`NODE_OPTIONS`・`SITE_URL`などを引き継がない。
- 別の署名jobは描画成功後、同一run/attemptの固定名artifactを取得し、download→attest→uploadだけを行う。checkoutやpacket解釈・候補コードの実行はしない。署名jobだけに`contents:read`、`id-token:write`、`attestations:write`を付与。registryへpushせず`create-storage-record:false`のため`artifact-metadata:write`は不要。署名tokenは書き込み権限を持つが記事・mainの変更権限はない。
- main/current PR/daily branch・PRと、同じslugの他のopen recovery packet PRのライブ照合を**生成前後**に実施。リストが100件に達して完全性が保証できない場合やAPI失敗時はfail-closed。最終JST日付・main前進・競合・403/404以外のHTTP/タイムアウトを含めfail-closed。出力を残す前にsource snapshotを再照合する。
- scratchにだけ`planDraft`→`applyDraft`→`validateDailyChange`→`build`を行い、ソースcheckoutのtrackedファイルは変更しない。既刊digest/候補ファイル/slug/記事数を検証する。
- 成功時に`trusted-unpublished-review-<run>-<attempt>` artifactの`offline-review.html`、`offline-review.json`、`preview.json`、`candidate-files.json`、`site/`、`trusted-preview.json`を生成。`trusted-preview.json`にはrun ID/attempt、workflow ref/SHA、event、base/head SHA、slug/variant/edition digest、packet/HTML digest、作成時刻/有効期限、`publicationAuthorized:false`を記録する。有効期限は最終ライブ照合後の`validateFreshness`と同じ翌JST 00:00。
- `unsigned-recovery-render-<run>-<attempt>`はjob間転送用の未署名artifact（保持1日）。署名jobが失敗しても残るため、**編集承認の証拠として受け付けない**。`site/publication.json`も仮想build receiptで、実公開receiptではない。
- 署名/転送が失敗した場合は**Re-run all jobs**で描画から再実行し、当該attemptのライブ照合と新しい受領証を作る。`Re-run failed jobs`や署名jobだけの再実行はattemptが変わり、転送artifactが存在せずfail-closedになる。古いattemptのartifactを署名し直したり固定名を緩めたりせず、期限切れなら当日原稿から作り直す。
- **GitHub ActionsによるOIDC署名Artifact Attestation**が紙面HTMLと`trusted-preview.json`のハッシュに対して**成功した場合のみ**artifactをアップロード。署名手順が失敗したら受入不可。
- この操作は紙面とレビュー用証拠を作るだけ。原典の意味的真偽・新聞の発行・`publication.json`の本番receiptを証明しない。

**注意：** PR #46未merge時の古い`Recovery preview (no publication)` / `unpublished-recovery-preview-*` artifactは**過去の候補生成テスト**にすぎない。現在の`Recovery implementation checks (not publication)`は、PR-headの合成テスト用。`recovery-packets/**`で起動せず、packet混入を拒否する。`recovery-live-status-*`はPR側コードで書かれた補助情報なので、**独立したtrusted証拠ではない**。古い手順を流用してはいけない。

## 3. ZIP/HTMLを開く前に署名と実行元を独立確認

**最優先はGitHubが署名したワークフロー身元。自己申告の`source:"trusted-main-pull-request-target"`やartifact名・JSON間の一致だけでは出所証明にならない。**

1. GitHub Actionsのrun画面で、`event=pull_request_target`、ワークフロー`.github/workflows/trusted-recovery-preview.yml`、成功した**attest/upload** step、run ID/attempt、GitHub-ownedの検証情報を確認する。`skipped`、PR-headだけの`build`、旧候補ワークフローの成功を合格と読まない。
2. 最終署名済みartifactを取得し、ZIPを展開。`offline-review.html`と`trusted-preview.json`の署名を**各ファイル単体で**検証する（GitHub CLI認証と対応オプションを持つ`gh attestation`が必要）。下記`BASE_SHA`は未検証JSONから自動採用せず、対象runの当時のprotected main・checkoutログ・workflow SHAをGitHubから独立取得し、40文字SHAとして固定する。その値が署名検証後の`trusted-preview.baseSha`/`workflowSha`とも一致することを要求する。

```sh
BASE_SHA='<GitHubから独立確認した40文字のpreview base SHA>'
gh attestation verify ./offline-review.html --repo hm2236/jamio-news --cert-identity https://github.com/hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml@refs/heads/main --source-ref refs/heads/main --source-digest "$BASE_SHA" --signer-digest "$BASE_SHA" --deny-self-hosted-runners --format json > html-attestation-verified.json
gh attestation verify ./trusted-preview.json --repo hm2236/jamio-news --cert-identity https://github.com/hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml@refs/heads/main --source-ref refs/heads/main --source-digest "$BASE_SHA" --signer-digest "$BASE_SHA" --deny-self-hosted-runners --format json > receipt-attestation-verified.json
```

3. 両コマンドのexit statusが0で、検証JSONに該当ファイルのverified attestationが存在することを確認する。各`verificationResult.signature.certificate`の証明書拡張から、`buildTrigger=pull_request_target`、GitHub-hosted runner、run invocation URIが`https://github.com/hm2236/jamio-news/actions/runs/<runId>/attempts/<runAttempt>`と完全一致することを確認する。フィールド欠落・不一致は停止。workflowが記述できる`statement.predicate`のtrigger/invocation一致だけで代用しない。両ファイルの署名元run/attemptは同一で、署名検証済み受領証の値とも一致させる。
4. `GET /repos/hm2236/jamio-news/actions/runs/<run-id>/attempts/<attempt>`を**GitHub APIから直接**確認。`event`、`path`、`run_attempt`、`conclusion=success`、描画/署名jobの成功および最終artifactのrun所属を突合する。runの`head_sha`だけでは`pull_request_target`の実行元を証明できない。
5. `GET /repos/hm2236/jamio-news/pulls/<PR>`で`base.ref=main`、exact head、base SHAおよび差分がpacket1個だけであることを照合。PR close後にも確認できる。trusted mainのcheckoutログと`JAMIO_TRUSTED_PREVIEW`行のSHA/digestを照合する。
6. 実HTMLのSHA256が署名検証済み`trusted-preview.offlineSha256`と一致し、slug/variant/digestが`preview.json`とも一致することを確認する。`offline-review.json`や未署名の補助ファイルは署名済み受領証との整合確認に使うだけで、単独の証拠にはしない。
7. `offline-review.html`をChromeで開き、**未公開・編集確認用**表示、見出し、本文、URL、出典、JST時刻、PC/スマホ折返しを編集者が確認する。CSSは埋込み、JS除去、CSP通信禁止。ただし公式出典リンクを実際にクリックすれば外部に遷移する。

**Attestationが見つからない・検証できない・違うrepo/workflow/refから署名されている場合は**、原稿がどんなに良くてもレビュー受入を**停止**する。GitHubの実行receiptと編集判断は別。成果物は7日保持だが、`expiresAt`と当日のJST日付を越えたpacketは発行できない。後日再生成する場合は新しいJST対象から。

## 4. 出版用daily PRと公開の承認

レビュー済み原稿があっても、packet-only PRは**trusted`daily-guard`で意図的にFAILする**（#49保護）。この失敗を無視してpacket PRをmergeしてはいけない。証拠を記録して**未マージclose**。

1. 別の`daily/YYYY-MM-DD-morning`等のbranchを**新fresh main**から作成。原稿/号ファイルだけをwrite-onceで追加し、各コミットに同一の`Candidate-Attempt`トレーラー、号を最終コミットのimmutable sealとする。失敗したpartial branchは修正・上書き・force-pushせずSTOP。
2. GitHubからdaily PRのfresh head/baseと保護ルールを取得し、**そのexact head/base**のtrusted main-controlled `daily-guard`と`build`の成功を確認。候補jobの同名checkやコピーされたJSONでは代用しない。trusted guardの実jobログから`JAMIO_DAILY_VALIDATION`を読み、`status=guard-passed`、PR番号・head/baseが現在のdaily PRと一致することを確認する。
3. **承認前の必須照合（N-1）:** 編集者が確認した§3の署名検証済み`trusted-preview.json`の**`digest`・`slug`・`variant`を、上記daily guardの同名3項目と完全一致**させる。日付と`expiresAt`も再確認する。違い・欠落・期限切れ・検証不能なら承認/mergeを停止。同じslugや成功した署名が複数ある場合も、実際に確認した1組を固定し、別runや別紙面に取り替えない。両digestは同じ`editionDigest`の計算なので、新fresh mainからdaily PRを作っても内容が同一なら一致できる。preview packetとdaily PRのhead/baseが同じであることは要求しない。
4. PR/Issue #15の承認記録に、編集確認者、明示承認文、時刻、preview PR番号・head/base・run ID/attempt・artifact ID・署名検証結果・HTML SHA256、承認対象`digest/slug/variant`、**daily PR番号・head/base・trusted guard run ID/attempt/job URL**を残す。CI成功でも自動公開権限ではない。通常merge直前にもfresh main/head・guard receipt・内容一致・JST期限を再照合。head変更、guard再実行、main前進で旧guardが失効、原稿変更時は停止して新しいguardと必要な編集確認/承認を取り直す。内容digestが変わったら必ず新しい署名済み紙面を再レビューする。
5. merged exact-main Pages/HTML/digest/slug/variant/URL/publication.json receiptが、**承認記録のdigest/slug/variant**およびdaily guardと一致して初めて`published`。別SHAの過去receiptで代用しない。朝刊がまだ発行できていない日は、夕刊のdaily PRを作らず記事調査・見送り判断だけにする。
6. notifier/lease/outbox/連続稼働acceptanceは別ゲート。恒常運用をLLMの無制限な自動判断に依存させない。

## 5. このPRのreleaseと残存検証

- Claude Code / Opus 5.5の[2回目独立レビュー](https://github.com/hm2236/jamio-news/pull/46#pullrequestreview-5456831157)はhead `081289a487cbe8d397c205b1ea0ca8204f5c2398`、main `137552438046ac6543c3a8e5bf164973f5f2baaf`、487/487を確認。P0/P1なし、前回P2-1〜4はコード修正済み（署名本番未実証）、新P2 N-1とP3 N-2〜6を報告。この修正後の**新exact SHAを独立Claudeに再レビュー**し、阻害指摘を修正・再検証するまでPR46はmerge禁止。GitHub投稿者は所有者`hm2236`だが実レビューはClaudeの別セッション。COMMENTは人間のGitHub formal Approvalではない。
- Codexが実装、Workがexact headを独立検証し、Claudeは別セッションでread-only再レビューする体制を維持。各実施者・対象SHA・CI/実行ログ・未実証項目をPRとIssue #15に残し、依頼だけを検証完了と記録しない。本番サイト公開・自動merge・secret/settings/ruleset変更は禁止。Bench PR38/39/40/43とIssue45は凍結。
- #49のmainへの適用と[PR #51](https://github.com/hm2236/jamio-news/pull/51)の拒否テストは完了。#46 merge後に、**新main当日JST**の使い捨てpacket-only Draft PRで真の`pull_request_target`実行、OIDC署名、HTML/receiptの独立検証を必ず再試験する。CIでの合成テストはその代替にならない。
- `required check`同名ジョブによる代替の可否は未検証仮説。sandbox repoでのみ検証し、production rulesetを直接弱めたり実験でメインに偽ジョブを入れたりしない。拒否ガードの本番受入を自己申告やPR-head statusだけで代用しない。

署名検証オプションと証明書/述語の信頼区分は[GitHub CLI公式](https://cli.github.com/manual/gh_attestation_verify)、storage recordの条件は[使用中の固定Action README](https://github.com/actions/attest/blob/1e69f48acb82d1966a394da916b4c1698aa569d6/README.md#artifact-metadata-storage-records)を参照。証明書identity/source digestの実際の値はmain導入後の受入試験で確認し、不一致を理由に検証条件を緩めない。
