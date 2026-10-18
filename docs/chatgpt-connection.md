# ChatGPTプランによるLLM接続

Cloudflare版のLLM接続はChatGPT認証を使用し、モデルは `gpt-6-luna` に固定する。
教材作成・審査、授業中の台本と板書、質問対応が同じ接続を使う。
音声は既存のFish Audio `s2.1-pro-free` のまま。

## 現在の前提

2026-10-18時点で、AITuber用Web OAuthクライアントは未発行。
本番の認証・Luna推論・実教材生成は未確認。未登録を成功や接続済みとは表示しない。

公式のWeb向けSIWCは登録済みクライアントが必要。OSS向け自動登録の
`dynamic_agent_client` はHTTP loopbackコールバック向けなので、CloudflareのURLに流用しない。
既存のCodex認証ファイルやChatGPTの非公開backend-apiも使わない。

## 登録に必要な内容

[OpenAIの利用希望フォーム](https://openai.com/form/sign-in-with-chatgpt-interest/)で、
Webでのサインインだけでなく **ChatGPT plan usage / Responses API** の利用を申し込む。
本人確認専用のOAuthクライアントでは推論に使えない。

- アプリ名: AITuber
- アプリURL: `https://aituber.mani1261790.workers.dev/operator/`
- コールバックURL: `https://aituber.mani1261790.workers.dev/auth/chatgpt/callback`
- 用途: 運営者本人のChatGPTプランで、アップロードした教材から授業パッケージ、台本、板書を生成する。視聴者はChatGPT認証不要。
- モデル: `gpt-6-luna`
- 必要な権限: `openid profile email offline_access resource.invoke chatgpt.tokens.use.direct`
- バックエンド: Cloudflare Worker + private Durable Object storage

OpenAIによる利用許可と発行情報を確認後、リポジトリのGitHub Actions Secretsへ設定する。

| Secret | 値 |
| --- | --- |
| `CHATGPT_CLIENT_ID` | 発行された `oaiapp_...` |
| `CHATGPT_REDIRECT_URI` | 上記の完全一致URL |
| `CHATGPT_PLAN_USAGE_ENABLED` | **ホスト型アプリのプラン利用許可を得てから** `true` |
| `CHATGPT_CLIENT_SECRET` | confidential / client_secret_basicとして発行された場合のみ |

`CHATGPT_PLAN_USAGE_ENABLED` はOpenAIの利用許可を取得する設定ではない。
発行された契約・認証方式がこの実装と異なる場合は、有効化する前に対応する。
秘密情報はチャットに貼らず、GitHub Actions Secretsへ直接入力する。
設定後は通常のCloudflareデプロイワークフローを実行する。

## 操作と検証

1. 管理画面の「LLM接続」で `Continue with ChatGPT` を選ぶ。
2. アカウントを確認し、AITuberによるChatGPTプラン使用を許可する。
3. 認証後、署名・issuer・audience・nonce・scopeを検証する。
4. 同じアクセストークンで `/v1/models` を取得し、Lunaが利用できる場合のみ接続を有効化する。
5. 「管理画面へ戻る」から「接続をテスト」。実Responses生成が完了することを確認する。
6. PDFを登録して自動作成・審査が合格し、Course Packageが登録されることを確認する。
7. 新規授業で台本・Fish Audio・モーション・板書とUnit遷移を別途確認する。

接続テスト成功だけでは、PDF教材生成や授業全体の成功とはしない。
ローカルの単体テストは認証とストリームの模擬応答であり、実接続の証明ではない。

## 実装上の扱い

- PKCE、state、nonce、10分で失効する一度限りの認証トランザクション。
- 管理者だけが接続開始・接続テスト・切断を実行できる。同一OriginのPOSTが必要。
- コールバックは別のSecure/HttpOnly/SameSite=LaxトランザクションCookieに結び付ける。
  既存管理ログインCookieのSameSite=Strictは維持する。
- トークンはDOの非公開ストレージに保存し、ブラウザへ返さない。
  更新は接続単位で直列化し、ローテーションされたrefresh tokenを保存する。
- `/v1/responses` へ `store:false, stream:true`。`response.completed` を受信するまで成功扱いにしない。
  スキーマ検証と既存の教材審査を通す。
- API従量料金への自動フォールバックはない。プランやアプリの上限は残る。
  Responsesのトークン数を保持するが、API価格からドル費用を推定しない。
- 「切断」はローカルの認証情報を破棄し、OpenAIの更新セッションも失効させる。
  リモート失効が確認できない場合はChatGPT設定で解除するよう表示する。

## 公式仕様

- https://developers.openai.com/siwc/website
- https://developers.openai.com/siwc/request-client-id
- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developers.openai.com/siwc/token-sharing-open-source/models-and-inference
- https://developers.openai.com/siwc/token-sharing-open-source/preview-limitations
- https://developers.openai.com/siwc/token-sharing-open-source/profiles-and-sessions
