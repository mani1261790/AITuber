# OpenAI互換LLM接続

AITuberは同時に一つのLLM接続だけを使う。運営画面の「LLM接続」にはAPIキーとモデル名を置き、Base URLはその中の「詳細設定」にだけ置く。保存済みAPIキーはブラウザーへ返さず、設定済みかどうかだけを表示する。ローカルファイルは権限600で `.data/llm-settings.json` に保存する。

```sh
pnpm configure:llm
pnpm verify:llm
```

`configure:llm` はAPIキーを画面へ表示せずに受け取り、`.env` を権限600で保存する。OpenAIではBase URLを空欄にする。Ollamaではモデルを先にpullし、APIキーを空欄、Base URLを `http://localhost:11434/v1` にする。

CLI設定は初回起動前やヘッドレス運用向けである。運営画面から保存した値は以後の画面設定として優先され、API応答やログへキーを含めない。

```sh
ollama pull qwen3:8b
pnpm configure:llm
```

設定名は次の3つだけを通常利用する。

| 設定 | 必須条件 | 例 |
|---|---|---|
| `AITUBER_LLM_API_KEY` | 外部エンドポイントでは必須 | 入力は非表示 |
| `AITUBER_LLM_MODEL` | LLM利用時は必須 | `qwen3:8b` |
| `AITUBER_LLM_BASE_URL` | OpenAI以外で指定 | `http://localhost:11434/v1` |

外部LLMでは、利用モデルの現在の公表単価を `AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS` と `AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS` に設定し、教材作成と授業時の1日費用上限も設定する。`configure:llm`が非表示のAPIキー入力に続けてこれらを尋ねる。単価または該当する費用上限が空なら、有料呼出を開始しない。モデルの単価をコードへ固定しない。Ollamaのloopback URLは自動的に入出力0 USDとして扱い、費用上限なしでも利用できる。

最大token量も呼出前に予約する。既定は教材作成1日100,000,000 token、授業時1日10,000,000 tokenで、`.env`から変更できる。詳細は[データ保持、費用予約、入力防御](./data-security-and-costs.md)を参照する。

## 呼び出し契約

`OpenAiCompatibleLlmProvider` は生成、独立審査、ライブ補足ごとに `createContext` する。contextにはその役割のsystem instructionだけを持たせ、過去の生成結果や別contextのmessageを保持しない。毎回 `system` と今回の `user` の2 messageだけを送る。

すべての応答にJSON Schemaを要求し、受信後もAjvで検証する。未知フィールド、必須値の欠落、型違い、`maxItems`や`maxLength`超過を実行前に拒否する。HTTP envelopeとmessage contentの両方にJSON構文検査を行い、HTTP応答全体は既定1 MB、呼び出し単位では最大10 MBに制限する。schemaエラーは最大20件に切り詰める。

共通結果は検証済みの値、実際のモデル、入力・出力・合計token、任意の費用見積り、待ち時間を含む。timeoutと呼び出し元の取消しを区別する。429、5xx、一時的なネットワーク障害は全体timeout内で1回だけ再試行し、それ以外の4xxや不正応答は再試行しない。エラーにはAPIキー、prompt、生成本文を含めない。

`FixedResponseLlmProvider` は同じcontext、schema、上限の契約を通る再現可能な試験用Providerである。次の教材生成Issueではこの契約を使い、候補生成と独立審査を別contextで実行する。

互換リクエストはOpenAIのJSON Schema `response_format` と、Ollamaが公開しているOpenAI互換Chat Completionsに合わせている。

- [OpenAI Structured Outputs](https://platform.openai.com/docs/guides/structured-outputs)
- [Ollama OpenAI compatibility](https://docs.ollama.com/api/openai-compatibility)
- [Ollama Structured Outputs](https://docs.ollama.com/capabilities/structured-outputs)
