# Cloudflare hosting

## 2026-10-07 の移行方針

ユーザーの要望: Macに依存せず、iPhoneから講義画面と管理画面を使う。LLMは低コストを優先し、日本語教材・数式・台本生成の品質を確認する。

- Workers Static Assets: `/` 講義、`/operator/` 管理。3Dの描画は閲覧端末。
- Worker: 管理ログイン、APIの権限境界、コンテナへの転送。
- Containers: 既存Node/SQLite/PDF抽出/音声生成/WebSocketを1インスタンスで実行。
- R2 `aituber-state`: 非公開の教材・設定・SQLiteのチェックポイント。
- 外部API: OpenAI Luna、既存Fish Audio。ローカルOllama/Irodori/OmniSVGには接続しない。

## 運用と保存の境界

コンテナのディスクは永続ではない。起動時にR2から復元し、管理APIの成功応答前、バックグラウンド処理中15秒おき、正常終了時に保存する。SQLiteにはbackup APIを使い、WALファイルを単純コピーしない。R2はアップロード成功後に現行オブジェクトが置き換わる。

現在は単一授業サーバー。実行中の授業と参加者接続はメモリ上にあり、異常停止・デプロイ後にその場から自動再開する機能は未実装。教材と設定は復元できるが、授業の開始操作は必要。処理中の教材作成は既存の再開機能を使う。異常停止時には直近の保存以降（通常15秒+保存時間）の更新が失われ得る。保存失敗時はログに記録し、管理APIは成功を返さない。アーカイブ上限95MiB。大規模利用前にファイル単位R2保存とDBの同期永続化へ移す。

20分の非アクティブ時にコンテナを停止。再アクセスで起動する。常時起動にはしない。会話の長期常時配信への拡張は別途。

## 認証

`/login` に管理用パスワード。署名付き7日間のSecure/HttpOnly/SameSite=Strict Cookie。管理APIと管理画面は未認証アクセスを拒否し、変更操作は同一Originのみ受け付ける。クライアントの `x-aituber-surface` は信用せずWorkerで上書き。教室は既存の参加コードと参加トークンを使用する。

R2中継は別のランダム秘密鍵のみ。キーや設定ファイルは静的配信しない。`.env`、`.data`、出力、モデル原本はDockerコンテキストに含めない。

## LLM選定（公式価格、2026-10-07確認）

通常の非キャッシュ入力/出力、100万トークン当たりUSD:

| モデル | 入力 | 出力 |
|---|---:|---:|
| GPT-6 Luna | 0.10 | 0.50 |
| GPT-5.6 Luna | 0.20 | 1.20 |
| DeepSeek V4.1 Flash | 0.15–0.30 | 0.60–1.20 |
| Gemini 3.5 Flash-Lite | 0.30 | 2.50 |
| Workers AI Qwen3.8 27B | 0.45 | 3.20 |

初期候補は `gpt-6-luna`。この表は日本語授業品質の実測結果ではない。APIキー登録後に教材作成・説明・数式・確認問題・質問分類を通して評価する。OpenAI Lunaは `max_completion_tokens` と `reasoning_effort:none`、非strict JSON Schema出力を使う。既存の任意フィールドを維持し、生成後のAJV検証は必ず実行する。

教材作成・授業それぞれのLLM日次予算を$2に設定。設定画面でモデルを変更する場合はWorkerの単価設定も更新すること。モデル単価の比較は、推論トークンや再試行を含む実使用量の請求額と分けて扱う。

公式資料:
- https://developers.openai.com/api/docs/models/gpt-6-luna
- https://developers.openai.com/api/docs/models/gpt-5.6-luna
- https://api-docs.deepseek.com/quick_start/pricing/
- https://ai.google.dev/gemini-api/docs/pricing
- https://developers.cloudflare.com/workers-ai/models/qwen3.8-27b/
- https://developers.cloudflare.com/containers/faq/
- https://developers.cloudflare.com/containers/platform/pricing/

ContainersはWorkers Paidプラン（月$5）と使用量課金。LLM・TTS料金は別。既存アカウントの利用枠も共有するため、アプリ固有の固定月額とは見なさない。

## デプロイ

```sh
pnpm build:cloudflare
pnpm exec wrangler types --config apps/cloudflare/wrangler.jsonc apps/cloudflare/worker-configuration.d.ts
pnpm exec wrangler deploy --config apps/cloudflare/wrangler.jsonc --dry-run
pnpm verify:cloud-account
pnpm deploy:cloudflare
```

Secrets: OPERATOR_PASSWORD, STATE_SECRET, FISH_API_KEY, FISH_VOICE_ID。OpenAI APIキーは公開済み管理画面で登録できる（OPENAI_API_KEY Secretで初期値を設定する方法もある）。秘密値をソース・コマンド引数・ログへ出さない。

`pnpm verify:cloud-persistence` は、独立した一時データと模擬オブジェクト保存先で、保存完了後の応答と、空の新プロセスへの復元を検証する。実Cloudflareの稼働確認とは別。

## デプロイ先の訂正と停止（2026-10-07）

誤ってSchedia側のアカウントへ作成したリソースは削除した。ユーザー指定の対象は `mani1261790@gmail.com` 側のアカウント。ログインメールとリソース所属アカウントは別々に確認すること。ユーザー指定URLにより、正しいaccount_idは `2ea670c2a6ff28e248ef084adf095e8b` と確定し設定に固定した。既存OAuthではこのアカウントへのAPIアクセスが403になるため、アクセス権を確認するまで再デプロイ禁止。専用の `aituber-personal` 認証プロファイルを使用し、既存のグローバル認証を変更しない。認証完了後もログインメールだけで判断せず、指定アカウントへのアクセスを確認する。

CLIのみで進める場合もCloudflareの認証済み資格情報が必要。`pnpm deploy:cloudflare` は専用プロファイルまたは環境変数 `CLOUDFLARE_API_TOKEN` を使用し、指定アカウントへのAPIアクセス確認に成功してからビルド・デプロイする。グローバルのデフォルト認証へのフォールバックはしない。トークンは画面・ログ・チャットへ出さない。OAuthやデバイス認証で新しい権限を得るにはCloudflare上で本人による承認が必要で、CLIのみでは完結しない。
