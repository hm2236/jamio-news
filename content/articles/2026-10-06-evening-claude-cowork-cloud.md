---
{"title":"Claude Cowork、Pro/Maxの新規タスクをクラウド実行へ","summary":"Anthropicは10月6日からPro/Maxの新しいCoworkタスクをクラウド実行へ移し、「Only on your computer」を廃止する。PCを閉じても継続・予定タスクも端末不要になり、じゃみおが考えている無人開発ではClaudeの役割が一段変わる。","category":"ai","tags":["Anthropic","Claude","Cowork","AIエージェント","自動実装"],"status":"verified","kind":"news","published":"2026-10-06T17:00:00+09:00","verificationNote":"Claude Help Centerの10月6日変更案内とscheduled tasks文書を確認。Pro/Maxの新規Coworkタスクがクラウド実行になり、既存のローカル開始タスクはそのまま残ることを確認した。","sources":[{"title":"Use Claude Cowork on web, desktop, and mobile","type":"official","url":"https://support.claude.com/en/articles/15520349-use-claude-cowork-on-web-desktop-and-mobile","checked":"2026-10-06T16:48:00+09:00"},{"title":"Schedule recurring tasks in Claude Cowork","type":"official","url":"https://support.claude.com/en/articles/13854387-schedule-recurring-tasks-in-claude-cowork","checked":"2026-10-06T16:49:00+09:00"}]}
---
# 何が変わったか
Anthropicは2026年10月6日から、ProとMaxで新しく開始するClaude CoworkのタスクをユーザーPCではなくAnthropicのクラウドで実行する。設定にあった「Only on your computer」も削除される。すでにローカルで開始済みのタスクは、そのままローカルで完了まで続けられる。

クラウド化の実用上の差は大きい。ノートPCを閉じても処理が継続し、scheduled tasksも端末をオンラインにしておく必要がない。セッションとファイルはClaudeアカウント側に保存され、デスクトップ、Web、モバイルをまたいで扱える。

# 従来との差と背景
これまでCoworkを「自分のPC上で動く作業者」と見れば、端末の稼働状態が実行継続の条件になり得た。今回の変更後、Pro/Maxの新規タスクはクラウド側が実行主体になる。これは単なる同期機能ではなく、常時稼働エージェントとして使う際の運用条件を変える変更だ。

一方で、ローカル実行を選びたい利用者にとっては選択肢が減る。クラウドセッションでは、作業ファイルやセッションがClaudeアカウント側に置かれるため、機密性やデータ配置の要件はローカル実行時と同じではない。Anthropic自身もクラウドとローカルのアクセス範囲を別のアーキテクチャ説明で区別している。

# 数字と運用上の意味
今回の重要な数字は性能ベンチマークではなく「端末オンライン不要」だ。無人処理では、モデル性能が高くても実行PCのスリープ、再起動、ネットワーク切断で止まれば運用コストになる。クラウド継続はこの故障点を一つ減らす。

scheduled tasksは通常のCoworkと同様に接続ツール、skills、インストール済みpluginsを利用できるとAnthropicは説明している。日次レポート、定期調査、ファイル整理などが例示されており、定期的な監視・整理役との相性は良い。

# 競合・代替
OpenAI側もWorkや常時稼働型エージェントを強化しており、「端末を閉じても仕事が続く」こと自体がクラウドエージェントの競争軸になっている。ローカルCodex/Claude Codeのような開発エージェントは、手元のリポジトリやWindows固有環境へ直接触れやすい一方、常時稼働には実行PCと監督基盤が必要になる。

したがって全部をClaudeへ移すというより、クラウドで安全に完結する調査・レビュー・定期整理と、Windows実機が必要な実装・検証を分ける構成が現実的だ。

# 強気・弱気シナリオ
強気では、Proの月額枠でも「人間API」を減らし、調査、仕様整理、GitHub上のレビュー、定期タスクをクラウド側へ逃がせる。ChatGPT WorkとClaude Coworkを別系統の作業者として使えば、一方の利用上限や障害時にも役割分担しやすい。

弱気では、クラウド化しても利用上限そのものが消えるわけではない。さらにローカル限定を選べなくなるため、機密ファイルや職場PC固有の操作を安易に渡すべきではない。クラウド側からアクセスできるツール・ファイルの権限設計も必要になる。

# 未確定点と今後見る指標
今回の公式文書だけでは、長時間タスクでの実効的な利用量、混雑時の待ち時間、Claude Codeとの境界、Proで常用した場合の上限消費ペースまでは判断できない。今後は、Proで1日に何本の実作業を安定して完走できるか、scheduled tasksの失敗率、GitHub連携時の権限分離、クラウド実行からローカル実機へ安全に引き渡す方法を見る必要がある。

## じゃみお向けの見立て
これはClaudeの20ドルプランを検討する材料としてかなり大きい。特に「ChatGPTとClaudeが人間を中継せず共存する無人開発」を考えるなら、Claude側を常時起動PCに縛られない調査・レビュー・定期整理担当にできる可能性が上がった。

ただし、kintai-calcのWindows PowerShell 5.1実機検証や職場PC固有の作業まで即座に移す話ではない。まずは機密性の低いGitHub上の調査・設計・独立レビューをClaude Cowork cloudへ切り出し、Proの上限消費と完走率を実測するのがよい。そこで数字が良ければ、ChatGPT Work＝統括、Claude Cowork＝独立調査・レビュー、Codex＝限定実装という三者分業を現実の運用候補にできる。