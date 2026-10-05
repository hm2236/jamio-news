---
{
  "title": "OpenAI DevDay 2026、Codex Cloud・Dots・GPT-6.1 Solで「常駐AI」を本格化",
  "summary": "OpenAIはDevDay 2026で20件超の発表を実施。GPT-6.1 Sol、Codexのクラウド実行、常駐型エージェントDots、Agents APIのcomputer useなど、自動化を継続運用へ寄せる機能が一気に増えました。",
  "category": "ai",
  "tags": ["OpenAI", "GPT-6.1 Sol", "Codex", "Dots", "AIエージェント"],
  "status": "verified",
  "kind": "news",
  "published": "2026-10-05T13:18:00+09:00",
  "verificationNote": "OpenAI公式DevDay 2026 recapで発表内容と提供範囲を確認。価格・提供プランは発表時点の情報として扱います。",
  "sources": [{"title": "DevDay 2026 Recap", "type": "official", "url": "https://openai.com/index/devday-2026-recap/", "checked": "2026-10-05T13:18:00+09:00"}]
}
---
## 何が変わった

OpenAIは9月29日のDevDay 2026で、ChatGPT、Codex、モデル、AIとの働き方にまたがる20件超の発表をまとめました。中でも、GPT-6.1 Sol、クラウドで動くCodex、継続的な役割を担うDots、computer useに対応したAgents APIは、AIを「その場で質問する道具」から「仕事を継続して受け持つ実行系」へ寄せる動きです。

GPT-6.1 Solは、OpenAIによるとエージェント型コーディング、computer use、専門業務を強化し、Astraの標準入出力トークン料金の5分の1で提供。Codexはクラウド実行や共有環境を使えるようになり、端末を閉じていてもタスクを進めやすい構成になりました。

## じゃみお視点

JAMIO NEWSやkintai-calcで進めている「人が設計し、CIやガードレールで自動実装を安全に回す」方向とかなり近いです。特にクラウド実行と継続タスクは、PCを常時占有せずにレビュー・調査・実装を回す構成へ移る材料になります。

ただし、常駐エージェントが使えることと、対象GitHubや外部サービスへの権限が自動で付くことは別問題です。今回のJAMIO NEWSでも、実際の書き込み権限を明示的に整える必要がありました。
