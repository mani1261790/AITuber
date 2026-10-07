# Cloudflare hosting

## 構成（2026-10-07）

Containersを廃止し、Workers・SQLite Durable Objects・R2へ移行した。

- Workers Static Assets: `/` は講義画面、`/operator/` は管理画面。VRM・教室・モーションの3D描画は閲覧端末で行う。
- Worker: `/login`、管理APIの認証・同一Origin検査、静的配信。
- SQLite Durable Object `LectureRoom`: 現在の授業、参加コード・参加トークン、質問、教材作成ジョブ、設定、利用量。MVPは単一教室・最大5人。
- R2 `aituber-state`: 原本PDF・音声キャッシュ・黒板SVG。公開バケットにはしない。
- 外部LLM/TTS: OpenAI互換APIとFish Audio。ローカルMacでOllama等を常時動かす必要はない。

Containers・Docker・サーバーGPUは不要。SQLite Durable ObjectsはFreeプランにも対応するが、Cloudflareの無料枠、LLM/TTSの料金はそれぞれ別。大量PDF・多数の同時利用を無料で無制限に処理できるという保証ではない。

## 永続化と再開

既存のドメインサービスを使い、Cloudflare用のSQL・ファイル・PDF・JSON Schemaアダプターを挟む。Nodeサーバーでは従来のbetter-sqlite3とローカルファイルを使える。

設定とジョブのJSONはDOのSQLiteに128KiB単位で保存する。原本のアップロードはR2への保存完了後に成功応答を返す。日本語PDF抽出はPDF.js 6のBinaryDataFactoryでCMap・標準フォントをASSETSバインディングから取得する。動的コード生成を必要とするAjvは、Worker上ではJSON Schemaインタープリターへ置き換える。

講義の状態変更ごとにチェックポイントを保存する。DO再起動後は現在の授業・完了Unit・参加コード・参加者を復元し、音声epochを更新する。途中のUnitは再生成・再読み上げになる場合がある。手動一時停止と確認問題の回答待ちは保持する。旧音声の重複再生はepochで防ぐ。デプロイ中も音声が完全に途切れないという保証ではない。

教材作成は生成・レビューを一反復ずつalarmで処理し、結果を保存して次へ進む。終了条件は従来どおり審査合格または予算切れ。外部APIの途中でプロセスが失われた場合は、その反復を再試行する可能性がある。保留中だったコメント分類は授業後回答へ送る。授業・教材作成中のalarmと定期削除用alarmで復旧と保持期限を管理する。

長時間連続配信・複数教室・過去の全授業を再開する機能は今回の移行範囲に含めない。

## 認証

管理ログインはOPERATOR_PASSWORDを使い、署名付き7日間のSecure/HttpOnly/SameSite=Strict Cookieを発行する。管理APIと画面は未認証アクセスを拒否し、変更操作は同一Originに制限する。教室は参加コードと参加トークンで認証する。

旧コンテナ向け `/_internal/state` は常に404。R2や設定を静的公開しない。STATE_SECRETは新しい実行環境では使用しない。

## アカウントの固定とCLI

対象account_idは **2ea670c2a6ff28e248ef084adf095e8b**、Worker名は `aituber`、subdomainは `mani1261790.workers.dev`。

ログインメールがmani1261790@gmail.comでも、ローカルのグローバルOAuthがアクセスできたアカウントはSchedia側だけだった。メールアドレスはリソースの所属先を保証しない。誤作成したSchedia側のAITuberリソースは削除済み。Noema・PHOTO-TEXTEなど既存サービスには変更を加えない。

GitHub Repository SecretのCLOUDFLARE_API_TOKENをActions上で使う。ローカルのグローバル認証は変更せず、デフォルトOAuthへのフォールバックもしない。

```sh
cd /Users/mani/Developer/AITuber
pnpm cloudflare:check
pnpm cloudflare:deploy
```

- `check`: 指定アカウントへの認証を読み取り専用で確認。
- `deploy`: GitHub **main** のコードを検証・ビルド・デプロイし、Actionsの完了を待つ。未コミットのローカル変更は送らない。
- 指定アカウントへのアクセスとWorker名を検証してからリソースを変更する。
- ローカルにはGitHub CLI認証が必要。CloudflareトークンをGitHubから読み戻すことはしない。
- Secrets: CLOUDFLARE_API_TOKEN、OPERATOR_PASSWORD、FISH_API_KEY、FISH_VOICE_ID。LLMキーは管理画面で登録できる。

初期LLM候補はgpt-6-luna。教材作成・授業のLLM日次予算はそれぞれ$2。キー未設定なら実際のLLM教材生成・質問回答は動かない。APIキー設定後に日本語教材・数式・説明の品質を評価する。料金をモデル変更時に見直す。

## 検証

```sh
pnpm build:cloudflare
pnpm exec wrangler types --config apps/cloudflare/wrangler.jsonc apps/cloudflare/worker-configuration.d.ts
pnpm --filter @aituber/cloudflare typecheck
pnpm verify:cloud-native
pnpm exec wrangler deploy --config apps/cloudflare/wrangler.jsonc --dry-run
```

`verify:cloud-native` は独立した一時保存先で実際のworkerdを起動し、管理認証・Origin拒否・授業作成・参加・WebSocket・日本語PDF・プロセス停止後の授業／ジョブ／参加トークンの復元を検証する。Cloudflare資格情報と有料APIは使用しない。本番疎通や実LLMの品質評価とは区別する。

v1の旧LectureBackendは、以前のWorkerアップロード時に登録済みのためmigration履歴に残す。v2でLectureRoomを作成し、未使用の旧クラスを削除する。

## 旧構成で止まった理由

2026-10-07の旧Containers構成は、正しいアカウントでも `containers/me` がHTTP 401 / code 1000「Deploying containers requires the Workers Paid plan」を返した。Workerアップロードは通ったが公開成功には至らなかった。今回の移行でこの依存とプラン検査を取り除いた。

- 旧デプロイ: https://github.com/mani1261790/AITuber/actions/runs/37597034001
- 旧診断: https://github.com/mani1261790/AITuber/actions/runs/37597386780
- https://developers.cloudflare.com/durable-objects/platform/pricing/
- https://developers.cloudflare.com/durable-objects/platform/limits/
- https://developers.cloudflare.com/durable-objects/api/alarms/
