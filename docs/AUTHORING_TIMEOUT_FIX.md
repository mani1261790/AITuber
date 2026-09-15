# PDF教材作成のタイムアウト修正

2026-09-15、保存済みPDFの作成処理が `LLM request timed out after 30000ms` で失敗していた。教材生成にも授業中と同じLLM呼出し30秒制限が適用されていたため。

- LlmSettingsStore は authoring に最大3600秒の通信上限、runtimeに従来の30秒を設定する。
- 作成ジョブの残り時間から AbortSignal を作り、生成と審査の両方に渡す。呼出しの延長によってジョブ全体の時間上限を超えない。
- ジョブの時間上限に達した場合は、チェックポイントを保持して budget-exhausted にする。
- 生成・審査のプロンプトには、既存の授業実行と同様にQwen向け /no_think を付加する。
- 311秒で返答する模擬LLMで、教材作成だけが成功しruntimeは30秒で中断することを検証。作成ジョブの時間上限による中断・データ保持も検証。

実機では300秒でも生成が終わらなかったため、authoring の通信上限はジョブ設定可能な時間と同じ3600秒とし、実際の停止はジョブの残り時間で決定する。新規ジョブの標準枠は15分へ調整する。明示的な時間指定、費用上限、上限後の再開フローは維持する。

実機のOllamaログでは4096トークンのコンテキストで生成途中に context shift が起きていた。同じ qwen3:8b を元に、`config/ollama/Modelfile` の num_ctx=16384 を使うローカルプロファイル `aituber-qwen3:8b` を作成し、運営設定のモデルを変更した。

再作成コマンド: `ollama create aituber-qwen3:8b -f config/ollama/Modelfile`

OllamaのOpenAI互換APIではコンテキスト長をリクエストから指定できないため、モデル側で設定する。
https://docs.ollama.com/api/openai-compatibility

追加検証で、非ストリーミング応答が約5分で切断され、HTTP層の再試行に入ることを確認。Node fetch の基盤である undici の headersTimeout も300秒なので、Ollamaには stream=true / include_usage=true を送るように変更した。SSEを内部で組み立ててから従来のJSON Schema検証へ渡す。日本語の分割UTF-8、利用量、途中終了、出力容量の上限をテストしている。
https://github.com/nodejs/undici/blob/main/docs/docs/api/Client.md
https://docs.ollama.com/api/openai-compatibility

実機結果: 保存済みPDFの同一ジョブで、修正後の生成が約361秒で完了し候補がディスクへ保存された。30秒・HTTP5分の切断を越えて取得できた。続いて決定的な参照検査で concept ID / target ID の混同と sourceIds への page ID の混入が見つかり、既存の自動局所修復へ進んでいる。これは教材の利用可能判定ではなく、今回の通信修正と次段階への到達の確認。lint・型チェック・178テストを通過。
