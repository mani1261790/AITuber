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

## 正しいアカウントでの実行結果（2026-10-07）

GitHub Actionsへユーザー登録のCLOUDFLARE_API_TOKENを設定。指定アカウントへのアクセス、認証・LLMの18テスト、型チェック、フロントエンド・サーバー・コンテナのビルドは成功した。R2 `aituber-state` 作成とWorkerコード・静的アセットのアップロードまで進んだが、Containersで停止した。

実行: https://github.com/mani1261790/AITuber/actions/runs/37597034001
診断: https://github.com/mani1261790/AITuber/actions/runs/37597386780

`GET /accounts/2ea670c2a6ff28e248ef084adf095e8b/containers/me` はHTTP 401、code 1000で「Deploying containers requires the Workers Paid plan」を返した。対象アカウントのWorkers Paid有効化が必要。workers.dev公開URLは404であり、公開成功とは扱わない。現在はこの検査をリソース変更前に実施する。プラン変更後に同じ手動ワークフローを再実行する。既存Noema・PHOTO-TEXTEのリソースは変更していない。

## アカウント取り違えの原因と接続方法

2026-10-07の `wrangler whoami --json` では、ログインメールはmani1261790@gmail.comでも、アクセス可能アカウントの一覧はSchedia側（36e8ab73692181d70a39ca42ce8f65c4）だけだった。メールアドレスはユーザーの識別であり、リソースの所属先やトークンの対象アカウントを保証しない。既存のグローバルOAuthを暗黙に採用したことが原因。

現在はAITuberのGitHub Repository Secretに対象アカウント用トークンを保持する。ローカルのCloudflare認証は変更せず、次のCLIがGitHub Actions上でそのトークンを使用する。CloudflareトークンをGitHubから読み戻すことはしない。

```sh
cd /Users/mani/Developer/AITuber
pnpm cloudflare:check
pnpm cloudflare:deploy
```

- `cloudflare:check`: 指定アカウントへの認証だけを読み取り専用で確認する。Containersのプラン制限とは分離。ローカルにはGitHub CLI認証のみ必要。
- `cloudflare:deploy`: GitHub mainのコードをデプロイする。ローカルの未コミット変更は送らない。現行構成のContainers利用チェックを含むため、Paid未契約なら停止する。
- アカウントIDとWorker名が想定外なら停止。デフォルトOAuthへのフォールバックは禁止。
- ローカルからCloudflare APIへ直接アクセスする専用資格情報は未登録。Actions経由の接続成功をローカルWranglerのログイン成功と混同しない。
- Noema・PHOTO-TEXTEに登録したSecretや既存サービスは変更しない。

## Containersを外す場合

3Dモデル・教室・モーションの描画は閲覧者のブラウザで行うため、ContainersやサーバーGPUは不要。現在Containersを使っているのは既存のNodeサーバーを大きく書き換えず移すためであり、製品要件上の必須条件ではない。

| 現行の依存 | Containersなしの移行先 |
| --- | --- |
| better-sqlite3とローカルDBファイル | SQLite-backed Durable Objects（授業状態）と必要に応じD1（一覧・履歴） |
| 教材、設定、SVG、音声のファイル保存 | R2と適切なDB/Secret保存 |
| 常駐Nodeサーバー、ws、メモリ上の進行・setTimeout | Durable ObjectsのWebSocket、永続状態、alarms、再開処理 |
| 教材作成のバックグラウンド処理 | 永続ジョブ状態と小さな処理段階への分割、再試行 |
| PDF抽出・スライド変換 | 現在のunpdf/pdfjs処理をWorkers上で検証。CPU/メモリ枠に収まらない処理は管理画面側へ移す等を検討 |
| LLM/TTSへの呼び出し | Workers/DOから外部APIへfetch |

Workersのnode:fsは通常の永続ディスクではなくメモリ上の仮想ファイルシステム。better-sqlite3のネイティブアドオンをそのまま移すこともできない。このためcontainers設定を削除するだけでは動作しない。

SQLite-backed Durable ObjectsはFreeプランでも利用可能だが、無料枠のCPU・ストレージ・リクエスト制限がある。PDF教材作成とライブ授業を実データで検証するまで、無料枠で全機能が動くとは断定しない。今回この移行自体は未実装。

参考:
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/workers/runtime-apis/nodejs/fs/
- https://developers.cloudflare.com/sandbox/concepts/
