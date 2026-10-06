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
