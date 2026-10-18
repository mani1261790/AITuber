# ChatGPTプランによるLLM接続

Cloudflare版は `gpt-6-luna` を使用する。教材作成・審査、台本・板書、質問対応が同じ接続を使う。音声はFish Audio `s2.1-pro-free` のまま。

## 初回だけMacで認証する

プロジェクトのルートで `pnpm connect:chatgpt` を実行し、開いたブラウザでAITuberのChatGPTプラン使用を許可する。管理用パスワードが保存されていなければ、ターミナルで非表示入力する。

AITuber専用のローカルOAuthクライアントを初回認証で発行し、その認証を承認済みのCloudflare本番に引き継ぐ。既存Codexの認証ファイルは使わない。個人利用のこの手順にWeb向けクライアントの事前申請は不要。

- コールバックはMacの `127.0.0.1` の一時ポート。認証完了後に終了する。
- `.data/chatgpt/registration.json` にクライアントIDなどを保存し、次回も同じ登録を使う。
- 引き継ぎ用の `.data/chatgpt/transfer.json` は権限0600、30分以内のみ有効。引き継ぎ成功時に削除する。失敗時は `node scripts/auth/chatgpt-transfer.mjs` で再試行できる。
- 本番URLは `https://aituber.mani1261790.workers.dev` に固定。管理者認証と同一OriginのPOSTが必要。
- Cloudflareがトークン更新と推論を担当する。Macを起動し続ける必要はない。
- 再認証が必要になった場合は同じコマンドを実行する。

## 検証

1. 本番の「LLM接続」が接続済みであることを確認する。
2. 「接続をテスト」でCloudflareからトークンを更新し、モデル一覧と実際のResponses生成を確認する。
3. PDFを登録し、自動作成・審査が合格してCourse Packageが登録されることを確認する。
4. 授業の台本・音声・モーション・板書は新規授業で別途確認する。

単体テスト、接続テスト、教材生成、授業の成功はそれぞれ別に確認する。

## 認証と推論

PKCE・state・nonceを使用し、IDトークンの署名・issuer・audience・有効期限・nonce、プラン利用scopeを検証する。引き継ぎ時にはCloudflareからモデル一覧を取得し、Lunaが利用できる場合だけ有効化する。

認証情報はDOの非公開ストレージに保存し、管理画面へ返さない。Cloudflare自身のhost IDを維持する。更新は直列化し、ローテーションされたrefresh tokenを保存する。切断は保存情報の削除とリモート失効を行う。

公開 `/v1/responses` を `store:false, stream:true` で呼び出す。`response.completed` とスキーマ検証を通過してから教材審査へ進む。API従量料金への自動フォールバックはない。ChatGPTプランの利用上限は残る。トークン数は記録するがAPI料金換算はしない。

登録済みWeb OAuthクライアントによる認証も残しているが、今回の個人用接続では使用しない。第三者向けのホスト型サービスへ認証機能を公開する場合は、その提供形態に適用されるOpenAIの条件を別途確認する。

## 公式仕様

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/self-hosted-vms
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
