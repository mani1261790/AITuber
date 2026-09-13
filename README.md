# 講義AITuber

登録教材から講義を自動構成し、音声、字幕、図・式、軽量2Dマスコットを同期して進行する教育向けAITuberです。授業中の質問や確認問題を学習上の証拠として扱い、必要な補足を自動生成・自動審査して本編へ戻ります。

現在はMVPを順に実装しています。開発リポジトリはprivateで運用し、MVP完成後のユーザビリティ評価と公開準備を経てOSS化します。

## ドキュメント

- [MVP要件定義](./REQUIREMENTS.md)
- [機能フロー](./docs/FLOWS.md)
- [実装計画とIssue一覧](./docs/IMPLEMENTATION_PLAN.md)
- [初期設計仕様 v0.2](./aituber_lecture_spec_v0.2.html)
- [ADR 0001: ワークスペースと境界](./docs/adr/0001-workspace-and-boundaries.md)
- [Course Package Contract v1](./docs/contracts/course-package-v1.md)
- [ローカル保存とイベント再生](./docs/storage.md)
- [講義状態機械](./docs/lesson-state-machine.md)
- [教室ステージ デザイン契約](./docs/design/classroom-stage-contract.md)
- [MVP検証教材](./docs/fixtures.md)
- [音声、字幕、取消し](./docs/audio.md)
- [OpenAI互換LLM接続](./docs/llm.md)
- [教材の取り込み・生成・審査](./docs/course-authoring.md)
- [質問受付と優先キュー](./docs/questions.md)
- [ライブ補足と本編への再接続](./docs/live-supplements.md)
- [確認問題、学習証拠、能動的な補足](./docs/learning-evidence.md)
- [授業末と授業後の処理](./docs/after-class.md)
- [LAN教室の参加と同期](./docs/lan-classroom.md)

要件が競合する場合は `REQUIREMENTS.md` を正本とします。

## MVPの到達点

Mac mini M2 16GBを基準ホストとし、次の3講義を一人で開始から終了まで実行できる状態を目指します。

1. 高校数学「二次関数」
2. 高校生物「DNA複製」
3. 大学レベル「VAEの再パラメータ化」

MVPには、教材生成と審査、本編の自動進行、確認問題、質問キュー、ライブ補足、再接続、Fish Audio音声、LAN参加、授業後処理が含まれます。

## 開発

Node.js 22とpnpm 10を使用します。

```sh
pnpm install
cp .env.example .env
pnpm dev
```

既定ではこのMacからだけ接続できます。同じLANの端末から参加させる場合は `.env` の `AITUBER_LAN_HOST` にMacのプライベートIPを指定します。起動後、運営画面に表示される6文字の教室コードを学習者が入力します。

Fish Audioを接続するときは、[APIキーの設定手順](./docs/audio.md#apiキーの設定)に従い、キーを画面に表示しない設定コマンドを使います。

```sh
pnpm configure:tts
pnpm verify:tts
pnpm measure:tts
```

LLMはAPIキー、モデル、必要な場合だけBase URLを一組設定します。Ollamaも同じ契約で接続できます。

```sh
pnpm configure:llm
pnpm verify:llm
```

接続後は運営画面の「教材を作成・取り込む」からPDF、画像、Markdown、テキストまたは講師ノートを登録します。授業時間だけを指定すれば対象レベルと学習目標を推定し、9項目の審査と自動修復を終えた教材だけが講義の選択肢に加わります。

- server: `http://127.0.0.1:4310`
- classroom: `http://127.0.0.1:4311`
- operator: `http://127.0.0.1:4312`

運営画面で教材と授業時間を選び、講義を開始します。教室画面は運営画面のリンクから開けます。状態はWebSocketで同期され、端末が切断しても授業は進み続け、再接続時は現在の説明位置から復帰します。

品質ゲートは `pnpm check` で、lint、型検査、単体試験、全ワークスペースのビルドを順に実行します。
