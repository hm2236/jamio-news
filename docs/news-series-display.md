# ニュースシリーズ 段階1 — 人手承認の表示基盤

追跡: [Issue #18](https://github.com/hm2236/jamio-news/issues/18)。設計正本は [news-series-design.md](news-series-design.md)。この基盤PRはレビュー待ちであり、main公開済みの宣言ではない。LLM提案shadow・guarded付与・自動merge・main保護設定は導入しない。#15の本番ゲート、朝刊shadowのmorning限定・fresh eventUrl条件、daily guardの許可範囲は維持する。

## 登録とレビュー

`contracts/series.schema.json` が専用contract、`data/series/<id>.json` が定義とmembersの正本。フォルダなしは空registryと同義。記事front matterにはseriesを追加しない。提案・草稿からの読込み経路はなく、buildはcheckoutのregistryだけを読む。

本番登録は基盤のmain反映後、**別のmaintenance PRで人手承認**する。CI成功やsidecarの自己申告フィールドでは承認を代替しない。PRに同一追跡対象の原典URL/確認箇所、前回からの新規性、scope・地域・版、expectedCount/日時/coverageの根拠、登録対象記事を記す。人手承認後だけmergeする。意味的な同一性・差分の事実確認は編集者の責任。

通常appendはactiveシリーズの定義と既存members prefixが不変の場合だけ。milestoneの逆行は拒否。定義変更・過去所属訂正・再編成・inactiveへの特別な追加は、revisionを厳密に1増やし、updatedAtを進め、changeNoteを変えた人手レビューPRへ分離する。IDの削除/改名と登録済み非空シリーズの空化は拒否。guarded用の書込み許可をこの検証関数から付与しない。daily PRは引き続き全sidecar変更を拒否する。

現mainには17記事・4号。28 Days Day 1/2記事はなく、同一の変化の列として根拠が揃う既存連続ニュースも確認できなかった。OpenAIのDevDay・広告・watermark、Anthropicのインフラ契約・Coworkクラウド移行は企業一致だけで統合できない。本PRのproduction registryは**空**。Day 1/2/5・朝夕・訂正などは隔離した仮想fixtureだけで検証する。

## 検証と表示

```sh
node scripts/validate.mjs
node --test
node scripts/build.mjs
node scripts/check-series-change.mjs <exact-base-SHA>
```

validatorは未知キー/型/空白、ID/filename、version、状態/実在JST日時、newsと所属号/date/variant、1記事1primary、昇順1..N、start/update/correction、eventKey、delta（160 Unicode code points）、先行記事への訂正参照、記事/号時刻の非減少、expectedCount、親の存在/自己参照/循環を検証する。別variantの記事を同一号に混入させることは拒否し、正しく所属する朝刊→夕刊の同シリーズ追跡は許可する。同時刻は明示sequenceを維持する。

PR CIはexact headをcheckoutし、exact baseのGit blobからregistryを読み、maintenance transitionを検証する。sidecar変更時は全既刊edition digest不変も追加確認する。新規シリーズのrevision=1、定義/所属改変時のrevision/updatedAt/changeNoteを強制する。人間の承認をサーバー側で強制するmain保護は未設定であり、このPRでは設定変更しない。

記事タイトル付近のシリーズ名/Day/掲載順と、本文末尾の「前の記事 / シリーズ一覧 / 次の記事」は静的HTML。現在の掲載順にaria-currentを付け、不在リンクは作らない。差分と訂正対象は独立表示。`/series/` は状態別・最終掲載順、`/series/<id>/` はscope・対象・状態・予定/実績日時・coverage・昇順全記事・個別確認状態・親子への入口を表示する。空seriesは一覧/ページに公開しない。親子へ前後ナビを接続しない。

記事URL、RSS guid/published、本文/summary、editionDigest contractVersion=1を維持する。未所属記事のHTMLは変わらない。号のTop 5差分・検索series絞込みは今回の表示対象に加えない。

## 追加のnavigation publication proof

`series-publication.json` はversion=1、exact commit、registryDigest、一覧indexのURL、各id/revision/URL/navigationDigestを含む。registryDigestはIDのASCII昇順で全sidecarをcanonical化したSHA256。navigationDigestは定義/members、参照記事のslug/title/published/status/URL、号identity/published/URL、導出previous/next、表示する親子のID/title/URLを含む。JSONキーを整列し、文字列はLFへ正規化する。receiptのcommitはdigestの入力ではなく、公開したsnapshotの別binding。

記事と個別一覧のHTMLにはseries ID/revision/navigationDigest、indexにはregistryDigestを埋め込む。過去記事へnextを追加するとregistry/navigation digestが更新されるが、既刊edition digestは変わらない。旧series receiptで新しいナビを証明しない。

Pages deployは既存の **Verify public deployment receipt** を維持し、その後の **Verify public series navigation receipt** で追加検証する。checkoutのHEADとGITHUB_SHAが一致すること、既存publication.json/edition receipt/最新号HTMLが一致すること、series manifest全体が一致すること、index・全公開series一覧・全所属記事のcanonical/metadata/生成リンクが一致することを要求する。各HTTP取得は15秒timeout・cache回避、公開反映待ちは最大20回/約10分。不一致はPages workflowをfailureにし、series付与成功/通知とは報告しない。

追加ログは `JAMIO_SERIES_PUBLIC_RECEIPT ` JSON、status=`series-receipt-verified`、manifest全項目と検証済みURL列を含む。空registryもindexを検証する。既存 `JAMIO_PUBLIC_RECEIPT` は置換しない。

API-onlyでは、**exact merged main SHA / main / pages.yml / pushまたはworkflow_dispatchの最新成功run** をGitHubから取得し、そのrunのdeploy jobの最新attemptの実ログから両receiptを読む。コピーされたJSON・PR CIログ・以前のattemptは証拠にしない。registry/参照記事をそのSHAから読み、期待manifestとindex→ID順のseries一覧→sequence順の各記事URL列を再計算して、commit/registryDigest/各id/revision/URL/navigationDigest/全検証URLを照合する。`assertRemoteSeriesPublication` はこの追加照合を実行する仕様で、既存edition receiptを同じcommitで必須にする。既存edition側のexpected URL/digest比較も既存confirm/remote-proof手順で行う。series receipt単独では公開完了にしない。

直接公開確認は `verifySeriesDeployment(root, exactMainSha)` で既存証明と追加証明を両方照合できる。GitHub workflow成功確認は呼出し元が行う。公開確認用CLIはtrusted Pages deploy専用で、PR head/未mergeのローカルpreviewをpublishedとは扱わない。

## 回帰とQA

- 既存88テストに、欠番/重複/Day欠落、朝夕/同時刻、guide/別variant、親循環、訂正、inactive append、prefix/definition改変、revision、既刊digest不変、canonical/LF、親子ナビdigest、HTML/manifest/log証明の一致・不一致を追加。
- 基盤base `c65179d60c8215c548d6d187ce9909d359d69176` との実build比較では、既存HTML/RSS/search/publicationの37ファイルが完全一致、全4号のdigest/URL/identityが一致。
- Edge/Chromiumの隔離fixtureで320/375pxとPC1280px、light/dark、JS無効、Tab/Enterによる一覧移動を実描画検証。横はみ出し0、固定下端ナビへのフォーカス重なり0、seriesリンク44px以上。CIでも320px相当のgrid/折返し/44px/focus/native a構造を検証。実機Safari/スクリーンリーダーの検証は未実施。

## 段階2へ進む前

この基盤PRの人手レビューとmerge、exact merged mainのPages成功＋両receiptの実公開照合が先。実シリーズ登録は原典/所属の根拠を揃えた別人手PRで行う。段階2ではdetached proposal/evidence、registry/source/package/run/attempt/base binding、対照候補と誤結合/見落とし評価、最低7連続日のread-only shadowを別PRで導入する。夕刊shadow・mutable URLの新イベント識別は独立設計。#15本番ゲートやdaily guardの緩和は段階3以降の別レビュー。
