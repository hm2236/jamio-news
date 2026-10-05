---
{"title":"OpenAI、EU向けChatGPT/Codex出力に不可視ウォーターマークへ","summary":"EUでは今後数週間で対象となるChatGPT/Codexのテキストに不可視の印が入る。APIは世界で任意選択なので、開発用途への直撃は限定的だが、生成物の来歴管理は実装要件になり始めた。","category":"ai","tags":["OpenAI","Codex","EU AI Act"],"status":"verified","kind":"news","published":"2026-10-06T06:15:00+09:00","verificationNote":"OpenAI公式発表で、APIの任意選択とEUのChatGPT/Codexへの段階導入を確認。検出精度や対象モデルの全範囲は今後の運用確認が必要。","sources":[{"title":"Our approach to EU text provenance rules","type":"official","url":"https://openai.com/index/eu-text-provenance/","checked":"2026-10-06T06:04:00+09:00"}]}
---
# 何が変わる
OpenAIはEUの生成AI透明性ルールへの対応として、対象となるChatGPTとCodexのテキスト出力に、今後数週間で不可視のウォーターマークを付ける方針を示した。API利用者は地域を問わず、対応モデルでウォーターマークを任意に有効化できるが、既定ではオフだ。

# 自動実装への意味
コードや文書をAIエージェントが大量生成する現場では、品質だけでなく「どの生成物がAI由来か」を追跡する要件が強くなる。現時点で日本のCodex利用が一律に変わる話ではないが、EU向け成果物や海外顧客を持つ開発では provenance をCIや監査ログに組み込む流れを先取りしておく価値がある。

検出器はまず研究者・専門組織向けに限定される。つまり「印が付く＝誰でも確実に判定できる」ではない。編集部としては、ウォーターマークだけに依存せず、Gitのcommit、PR、CI receiptのような既存の証跡を正本にする設計が堅いと見る。

## じゃみお向けの見立て
kintai-calc型の自動実装では、いま採っているPR・CI・SHA・receipt中心の証拠設計と相性がいい。日本国内の個人開発で慌てて対応する段階ではないが、AI生成物の来歴が「便利機能」から「契約・法令対応」に昇格し始めたニュースとして追跡したい。