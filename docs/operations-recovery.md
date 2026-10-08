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
- 書き込み不能の`contents: read`と`pull-requests: read`の`GITHUB_TOKEN`をAPI読み取りに使用。`persist-credentials:false`、秘密やPR提供コードを一切実行しない。OIDC署名に限定した`id-token:write`、`attestations:write`、`artifact-metadata:write`は**記事・mainへの書き込み許可ではない**。
- main/current PR/daily branch・PRのライブ照合を**生成前後**に実施。最終JST日付・main前進・競合・403/404以外のHTTP/タイムアウトを含めfail-closed。出力を残す前にsource snapshotを再照合する。
- scratchにだけ`planDraft`→`applyDraft`→`validateDailyChange`→`build`を行い、ソースcheckoutのtrackedファイルは変更しない。既刊digest/候補ファイル/slug/記事数を検証する。
- 成功時に`trusted-unpublished-review-<run>-<attempt>` artifactの`offline-review.html`、`offline-review.json`、`preview.json`、`candidate-files.json`、`site/`、`trusted-preview.json`を生成。`trusted-preview.json`にはrun ID/attempt、workflow ref/SHA、event、base/head SHA、packet/HTML digest、作成時刻/有効期限、`publicationAuthorized:false`を記録する。
- **GitHub ActionsによるOIDC署名Artifact Attestation**が紙面HTMLと`trusted-preview.json`のハッシュに対して**成功した場合のみ**artifactをアップロード。署名手順が失敗したら受入不可。
- この操作は紙面とレビュー用証拠を作るだけ。原典の意味的真偽・新聞の発行・`publication.json`の本番receiptを証明しない。

**注意：** PR #46未merge時の古い`Recovery preview (no publication)` / `unpublished-recovery-preview-*` artifactは**過去の候補生成テスト**にすぎない。現在の`Recovery implementation checks (not publication)`は、PR-headの合成テスト用。`recovery-packets/**`で起動せず、packet混入を拒否する。`recovery-live-status-*`はPR側コードで書かれた補助情報なので、**独立したtrusted証拠ではない**。古い手順を流用してはいけない。

## 3. ZIP/HTMLを開く前に署名と実行元を独立確認

**最優先はGitHubが署名したワークフロー身元。自己申告の`source:"trusted-main-pull-request-target"`やartifact名・JSON間の一致だけでは出所証明にならない。**

1. GitHub Actionsのrun画面で、`event=pull_request_target`、ワークフロー`.github/workflows/trusted-recovery-preview.yml`、成功した**attest/upload** step、run ID/attempt、GitHub-ownedの検証情報を確認する。`skipped`、PR-headだけの`build`、旧候補ワークフローの成功を合格と読まない。
2. artifactを取得し、ZIPを展開。`offline-review.html`と`trusted-preview.json`の署名を**各ファイル単体で**検証する（GitHub CLI認証と`gh attestation`が必要）。

```sh
gh attestation verify ./offline-review.html --repo hm2236/jamio-news --signer-workflow hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml --source-ref refs/heads/main
gh attestation verify ./trusted-preview.json --repo hm2236/jamio-news --signer-workflow hm2236/jamio-news/.github/workflows/trusted-recovery-preview.yml --source-ref refs/heads/main
```

3. `GET /repos/hm2236/jamio-news/actions/runs/<run-id>`を**GitHub APIから直接**確認。`event`、`path`、`run_attempt`、`conclusion=success`およびrunへのartifact所属を突合する。runの`head_sha`だけでは`pull_request_target`の実行元を証明できない。
4. `GET /repos/hm2236/jamio-news/pulls/<PR>`で`base.ref=main`、exact head、base SHAおよび差分がpacket1個だけであることを照合。PR close後にも確認できる。必要ならtrusted mainのcheckoutログと`JAMIO_TRUSTED_PREVIEW`行のSHA/digestを照合する。
5. `offline-review.json`の単体HTML SHA256と、実ファイルのハッシュが一致し、`trusted-preview.json`の`offlineSha256`/base/head/packet/digest・`preview.json`の内容にも矛盾がないことを確認する。
6. `offline-review.html`をChromeで開き、**未公開・編集確認用**表示、見出し、本文、URL、出典、JST時刻、PC/スマホ折返しを編集者が確認する。CSSは埋込み、JS除去、CSP通信禁止。ただし公式出典リンクを実際にクリックすれば外部に遷移する。

**Attestationが見つからない・検証できない・違うrepo/workflow/refから署名されている場合は**、原稿がどんなに良くてもレビュー受入を**停止**する。GitHubの実行receiptと編集判断は別。成果物は7日保持だが、`expiresAt`と当日のJST日付を越えたpacketは発行できない。後日再生成する場合は新しいJST対象から。

## 4. 出版用daily PRと公開の承認

レビュー済み原稿があっても、packet-only PRは**trusted`daily-guard`で意図的にFAILする**（#49保護）。この失敗を無視してpacket PRをmergeしてはいけない。証拠を記録して**未マージclose**。

1. 別の`daily/YYYY-MM-DD-morning`等のbranchを**新fresh main**から作成。原稿/号ファイルだけをwrite-onceで追加し、各コミットに同一の`Candidate-Attempt`トレーラー、号を最終コミットのimmutable sealとする。失敗したpartial branchは修正・上書き・force-pushせずSTOP。
2. 正確なhead/baseのtrusted`daily-guard`と`build`を確認。CI成功でも自動公開権限ではない。ユーザーの内容確認と明示した承認後に**通常merge**だけを行う。
3. merged exact-main Pages/HTML/digest/slug/variant/URL/publication.json receiptを照合して初めて`published`。別SHAの過去receiptで代用しない。朝刊がまだ発行できていない日は、夕刊のdaily PRを作らず記事調査・見送り判断だけにする。
4. notifier/lease/outbox/連続稼働acceptanceは別ゲート。恒常運用をLLMの無制限な自動判断に依存させない。

## 5. このPRのreleaseと残存検証

- Claude Code / Opus 5.5 が[PR #46 head a32964b の独立レビュー](https://github.com/hm2236/jamio-news/pull/46#pullrequestreview-5456457355)を実施。P2-1 artifact出所、P2-2 `$`置換、P2-3旧文書、P2-4匿名API、P3を報告。作成者はP2修正・追加テスト・exact-head CIまで担当し、**修正後の新SHAをClaudeに再レビュー**してからmainへ通常mergeする。人間のGitHub ApprovalとClaudeのCOMMENTは異なる。
- #49のmainへの適用と[PR #51](https://github.com/hm2236/jamio-news/pull/51)の拒否テストは完了。#46 merge後に、**新main当日JST**の使い捨てpacket-only Draft PRで真の`pull_request_target`実行、OIDC署名、HTML/receiptの独立検証を必ず再試験する。CIでの合成テストはその代替にならない。
- `required check`同名ジョブによる代替の可否は未検証仮説。sandbox repoでのみ検証し、production rulesetを直接弱めたり実験でメインに偽ジョブを入れたりしない。拒否ガードの本番受入を自己申告やPR-head statusだけで代用しない。
