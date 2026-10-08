# Discovery Radar Tranche 0A capture shadow

契約正本: [Issue #27 §17](https://github.com/hm2236/jamio-news/issues/27)、[ADR #26](https://github.com/hm2236/jamio-news/issues/26)、[Proposal C #24](https://github.com/hm2236/jamio-news/issues/24)。§17 amendmentsが初期記述に優先する。ニュース品質の評価や公開機能はこの実装に含まない。

## 境界と開始条件

専用workflowは毎時 `17 * * * *` と手動dispatchで実行する。repositoryと`refs/heads/main`を完全一致で確認し、`github.sha`をcredential非保持でcheckoutする。Node 22、10分timeout、専用concurrency、cancel-in-progress=false。権限はcontents:read/actions:readだけ。package install、secret追加、cache、state branch、PR生成、publish、通知はworkflowに存在しない。

実装開始時mainは`cd211e5c106012a7d7588d742b3c9cafe6ff425e`と一致した。AGENTS.md等の追加repo instructionsなし。PR #25はopen、head `08c1c822e1f4c3608f8e5ebd7734791319244026`。13変更pathと0Aの6pathに重複なし。既存autonomous/series/content/prices/Pages/READMEは変更しない。

runtimeの全出力とdownloadは`$RUNNER_TEMP/discovery-radar/`以下。workspace内のRUNNER_TEMP、symlink、既存outputの上書きを拒否する。

## 固定3 adapters

| source | lane / channel | cadence | metadata cap |
|---|---|---:|---:|
| HN official newstories + item API | Discover / aggregator | 1h | newest 1 item |
| 鹿児島県新着RSS | Sentinel / authority-local | 1h | 20 items |
| Anthropic News index | Watch / publisher | 2h | 20 list items |

HNはstate/transport proof用の小さいsample。全新着を網羅する宣言はしない。取得volumeの拡大は90日state budgetの別レビューが必要。source cadenceは最後の成功parse開始時刻から判定し、not-dueは`skipped-not-due`。empty、deleted/dead/missing/unsupported-type、errorを分ける。parser errorではcursorを進めず、部分的なHTTPS needs-reviewでは既知itemだけ保持し、sourceはerror/count付きで記録する。

HN canonicalUrlは`https://news.ycombinator.com/item?id=<id>`。外部URLは`discoveredUrls`というuntrusted metadataだけで、fetch・DNS解決・canonical identityに使わない。credential/query付きHN外部URLはartifactに入れずadapter errorにする。popularity (`score`, `descendants`)をcontent digestから除外する。digestの正本はbounded stable item fieldsであり、raw JSONやpage全体ではない。

鹿児島はbounded RSS 2.0 / Atom / RDF RSS 1.0 extractor。stack付きtokenizer、namespace、CDATA、basic/numeric entity、relative link、date/id/linkを扱う。DOCTYPE/ENTITY、nested item/entry、unknown namespace、malformed/unclosed、duplicate field、nested field、4096 nodes/16 depth/100 feed items/field boundsを拒否する。本文はfetchしない。新dialectに合わせて自動拡張しない。

XMLの属性・通常textは5 basic entitiesとnumeric entitiesのみ。unquoted/broken/duplicate属性（expanded nameの重複も含む）、裸の`&`、不正character、通常textの`]]>`、不正CDATA/comment/prologをfail closedにする。HTML用entity decoderの`nbsp`はXMLで許可しない。prefix/URIはdefaultのRSS 1.0/Atom、`rdf`のRDF、`d`/`dc`のDC、`atom`のAtom、`xml`の固定URIだけ。unknown binding・再binding/namespace shadowingを拒否し、抽出はURI + local nameを照合する。

配置はRSS 2.0の`rss/channel/item`、Atomの`feed/entry`、RDFの`rdf:RDF`直下の1 channelとitemに限定する。RDF sequenceは`channel/items/rdf:Seq/rdf:li`のみ。metadata fieldもdialectと親ごとのallowlistを使い、未知wrapperや別dialectのfieldを無視せず拒否する。既存鹿児島RDFのDC creator/subject/publisher/contributorはleafとして検証し、Observation/digestには追加しない。tree全体の構造検証を抽出前に行う。回帰fixtureはcaptureでObservation 0/source error/cursor不更新まで確認する。

HNの`{id:123,deleted:true}`等はobjectとpositive expected idのbinding後、live itemのtype検査前にdeleted/dead分類する。

2026-10-06 direct preflightの実feedはRDF、10 items、200 text/xml。HTTP linkをgenericにHTTPSへ変換しない。configの**個別URL**に、HTTP/HTTPS両方の200実取得、可視本文の正規化digest一致、HTTPS canonical URLの証拠を持つ場合だけupgradeする。元URLは`sourceUrl`とsource固有IDに残す。HTTP/HTTPS bytesはHTML minificationで異なることがある。現在9 URLsを確認、`genbokusiitakefea.html`は可視本文が異なるため未登録。未確認HTTP itemは`https-equivalence-needs-review`で除外し、子URLをruntimeでfetchしない。新しいHTTP URLは人手のequivalence reviewが必要。

Anthropicは`PublicationList…__listItem` anchor内の`__title` spanと表示timeだけをlocatorにする。正常item listがない、必要field欠落、未知URL/dateならparser-drift/error。nav、script、page全体の変更をObservationにしない。日付はdate precision、時刻を捏造しない。

source body受信完了がcapturedAt、parse/normalize後の認識がobservedAt。observedAt >= capturedAtを検査する。sourcePublishedAt/sourceUpdatedAtは別field。precisionはdate/datetime/unknown。raw本文・HN text・RSS descriptionはdigest計算後捨て、永続payloadにはtitle/link/time等のmetadataのみ入れる。excerptも保存しない。

## Network boundary

固定host/path family以外を拒否する。HTTPS、credential/port/queryなし、manual redirect（最大2）、同host・同reviewed endpoint policy内のみ。各hopで全DNS addressを検査し、private/loopback/link-local/documentation/reservedを拒否。HTTPS requestのlookupをその検査済みaddressにpinする。通常のfetchによる再DNS解決はしない。TLS検証はNodeの既定を維持する。

source credentialsなし。identity encoding、UTF-8 fatal decode、content-type allowlist、8秒timeout、HN/XML 256KiB・HTML 1MiB上限。chunked bodyも受信中に上限を検査する。ログは固定error codeとcountsだけでbody/任意exception messageを出さない。resolverとrequest transportはfixture注入できる。

GitHub tokenはActions metadata読み取りstepだけに渡す。固定api.github.com endpoint、manual/no-follow、DNS pin、read-only GET。downloadは公式download-artifact v4のrun-id + artifact-ids + tokenを用い、候補ごとに独立temp dir。download failureは次tierへ進める。

source preflightでrobotsを確認: Anthropic Allow `/`、鹿児島は別path `/kojisotatsu/`だけDisallow。鹿児島の[公式RSS案内](https://www.pref.kagoshima.jp/rss.html)と[リンク・著作権](https://www.pref.kagoshima.jp/copyright.html)を確認。公開記事本文の転載は行わない。Anthropicの[Consumer Terms](https://www.anthropic.com/legal/consumer-terms)はClaude等のServicesを対象とする。News indexのrobot allowanceを確認したが、これをClaudeサービスの自動アクセス許可へ転用しない。利用条件変更/禁止が判明したらcaptureを停止しIssue #26/#27へ戻す。

## Seenと復旧

Observation IDはsha256(`observation-v1\n` + sourceId + `\n` + source item IDまたはcanonicalUrl + `\n` + contentDigest)。canonical JSONはkey順序固定、UTF-8/LF。source IDが違えば衝突しない。同一Observation再pollではunique countを増やさず、実際の観測時刻だけ追加する。

stateはObservation identity → identifiers/channel/観測時刻の最小ledgerと、そこから検算するSeen rows、source cursors。Seen rowsはfirstSeenAt90d、lastSeenAt、uniqueObservationCount90d、firstObservationId90d、channelClassesを持つ。各Observationの実際のseenAtを90日windowでpruneして最古/最新を再計算する。lifetime first-seenは保持しない。意味entityの抽出・alias mergeなし。

Actions APIはlatest prior completed/success main runのrolling artifactを1候補だけ選ぶ。最新successful checkpointを1候補だけ選び、rollingがmissing/corruptならcheckpoint、それも不適合ならcold-start/degraded。任意older rolling/checkpointの解凍探索なし。repository artifact scanは最大30 pages、checkpoint run metadata検査は最大100件。境界超過/permission/API failureを「候補なし」と解釈せずrun failureにする。

artifactのAPI workflow_run.id、name内run/attempt、run APIのrepo/workflow path/branch/status/conclusion/headSha/latest attempt、manifestを照合する。manifest self-digest、encoded payload digest、canonical decoded state digest、contract/sourceConfig digestを検証する。unknown keys、future state times、derived Seen不一致は拒否。main head前進だけでcompatible stateを捨てない。manifestのpreviousStateDigest/imported artifact/run/attemptがchainを記録する。digestはsource claimsの真実を証明しない。

## Artifactsとmetrics

rolling `radar-shadow-<runId>-<attempt>` / retention14日:

```
manifest.json
state/seen.json.br
capture/observations.jsonl
capture/source-health.json
capture-report.json
```

daily `radar-daily-checkpoint-YYYY-MM-DD-<runId>-<attempt>`はmanifest + compact stateだけ。JSTのcapture完了日を使用する。plan時とrolling upload成功後にexisting successful checkpointを確認する。失敗runのcheckpointは存在確認/importから除外する。重複はcreatedAt/runId/attempt/artifactIdの順でdeterministicに選び、write lock/上書きはしない。

Seen JSONをNode標準Brotliでcompactに保存する（quality5、encodingをmanifestに固定）。復号上限8MiB、schema max20000 Observations。raw source bodyとは別である。**upload前local payloadの実file bytes総和**をrolling512KiB/checkpoint256KiBで検査する。GitHub ZIP後の圧縮sizeはacceptanceに使わない。budget超過時、90日stateの削減やsilent truncationで通さず停止する。

GITHUB_RETENTION_DAYSを記録し、daily retentionはmin(90, available)。90未満はretentionCapability=degraded。repo setting変更なし。rolling/checkpoint upload失敗はworkflow failure（always uploadなし）。captureのparser/source欠測は明示health=degraded、正常な前stateをcopy-forwardする。

capture-reportはpublicationAuthorized=false、run provenance、new/duplicate Observation、newlySeenIdentifiers、W/D/S counts、source health/classifications、import failures、local artifact bytes、source requests/response bytes、Actions plan requests、retentionを記録する。checkpoint再確認の追加Actions request数はそのstepの固定JSON logに記録する（reportは既にimmutable rolling artifact内にある）。Actions download/upload自身の内部HTTP回数はscript metricの範囲外。

scheduleDelaySecondsはrun creation以前の最新`:17`slotからcollector開始までの値。GitHubは失われたcron予定時刻をAPIで保証しないため、推定methodをreportに明示する。original runCreatedAt、実際のcollector startedAt/completedAtを別に保持し、dispatchはdelay=null。

## 検証と未実証

fixturesはtest/discovery-radar.test.mjs内にあり、live Internetを使わない。既存test/validate/build、edition digests、series registry/navigation proof、全生成出力の比較を別に行う。新dependencyなし。Event/Revision/Claim/RadarBrief、semantic extraction、convergence/burst、他source、高頻度JMA、price、記事生成、editorial/series handoff、publishing/notificationなし。

merge後のreal Actionsで最低7連続JST日、目標14日を別途証明する。現時点でreal schedule、read-only tokenによる実artifact recovery、90日実volume/retention、schedule gaps、public artifact exposure、parser継続率を達成したとは主張しない。HN sample1/hourのfixtureが90日でbudgetに収まることは実RSS/HTMLを含む90日運用の証明ではない。

想定外のwrite権限/追加path/PR #25 overlap、read-only download不能、provenance再構築不能、構造的budget超過、規約禁止、browser/CAPTCHA、未知redirect/domain、raw本文保存の必要、契約外feedが判明したらscopeを広げずSTOPし#26/#27へ証拠を返す。

## W0: state/source-config compatibility（Issue #54）

[W0契約](https://github.com/hm2236/jamio-news/issues/54)は[relay #53](https://github.com/hm2236/jamio-news/issues/53)の独立改修。実装baseは `137552438046ac6543c3a8e5bf164973f5f2baaf`。固定3source、ネットワーク境界、cadence、workflow、retention、二段回復、公開権限は維持する。source configそのものはこのPRで変更しない。

従来の全contract/config digest完全一致だけの回復では、個別HTTPS同等性証拠を足しても全stateが失われる。実artifact `11534029287`（[run 37743517204](https://github.com/hm2236/jamio-news/actions/runs/37743517204)、attempt1、head `258b92db13fdfc74259fb0550e7d2be883411343`）をread-onlyで取得し、凍結baseコードで30 Observationの正常importを確認した。同じartifactに対して、オフラインの合成proof追加だけを設定に施すと `compatibility` / cold-start / 0 Observationになる。合成proofは実sourceの同等性証明として採用していない。

新manifest v2は完全なsource-config snapshotとstate-policy fingerprintを持つ。snapshotから計算したdigestを `sourceConfigDigest` と照合し、既知の完全schema digestと独立のpolicy fingerprintも必須にする。policyはstate/Seen/Observationのschema、90日window、encoding、Observation/identifierの意味とadapter epochをbindする。未知のschema/policyは受理しない。将来のreport-only schema変更も、別の明示的な互換性更新なしには受理しない。コードの意味をdigestだけから自動証明するものではないため、意味変更時にはpolicy epochと移行契約のレビューが必要。

legacy v1にはsnapshotがない。監査済みの完全contract/config digest組だけを凍結snapshotへ対応付け、凍結legacy state-policy fingerprintとも一致したときに移行する。未知のlegacy組を新しい設定に合わせて推測しない。旧consumerはv2を拒否し、既存のcheckpoint/cold-start/degradedへ進むため、consumerを戻す操作を無損失rollbackとは扱わない。

| 旧→新source設定 | stateとcursor | 診断 |
|---|---|---|
| 完全一致 | ledger/cursor保持 | 継続 |
| 鹿児島の検証済み同等性proofを追加、旧proofは同じ値で全部保持 | ledger保持、鹿児島cursorのみ削除して再取得可能にする | migrationとして記録 |
| proof削除/置換、その他の許可された設定変更 | そのsourceのledger/cursorのみ削除、Seen再計算 | degraded/resetとして記録 |
| source追加/削除、未知field、未知policy/schema、不正proof/snapshot | candidate拒否 | checkpoint fallback、なければcold-start/degraded |

proofは一意な正確なHTTP→HTTPS mapping、同一許可host、200/200、method、時刻、normalized text digestを検証する。追加が既存proofを置換する場合は継続扱いにしない。identityの書換え、alias merge、synthetic Observation作成はない。Observation rowのidentifierは同一sourceへbindし、channel/URL境界も照合する。混在、将来時刻、不整合Seen、入力破損は受理しない。

現在の設定の不正・未来proof・偽consumer policyは、artifactがない初回でもrun failureとする。prior候補だけの不正はcheckpoint fallbackへ進める。state/cursorの時刻上限はconsumerの現在時刻だけでなくproducerの完了時刻。chainの自己run参照は別attemptでも拒否するが、run IDの大小から未知の時系列保証を推測しない。proof配列の並べ替えだけも現実装では保守的にsource resetとなる。

provenance・manifest/payload/state digest・UTF-8・復号上限の検証を移行前に行う。`previousStateDigest` と `imported.stateDigest` は移行前の**正確な元state**を指し、新stateは別digestとなる。coldStart/imported/previousStateDigestの内部不一致を拒否する。latest successful prior run/latest attemptのAPI選択と、rolling→checkpointの二候補上限は維持する。

digest整合性とAPI provenanceは暗号署名ではない。全祖先artifactを再帰取得して認証せず、compact legacy ledgerから同一source内のObservation hashを再構成することもできない。この制約をpoisoning全面防止やreplay全面防止の証明へ昇格しない。検出可能なsource/channel/URL混在・run/attempt/時刻/chain不整合を拒否し、未知の場合はfail closedとする。

受入は旧30→新30保持、dedupe、source単位reset、proof撤回、chain pointer、checkpoint fallback、未知schema/policy、入力破損、境界・budgetのfixtureと、全tests/validate/build/出力不変/exact-head Linux CI。実mainでのscheduled v1→v2移行、7〜14日連続運用、90日volumeとretention、source網羅性は別の未実証ゲートで、Draft PR/fixture成功から達成を主張しない。PR #46、凍結benchmark/#45、朝夕の予定タスクと刊行pathへの変更はない。
