# 講義AITuber

登録教材から講義を自動構成し、音声、字幕、図・式、軽量2Dマスコットを同期して進行する教育向けAITuberです。授業中の質問や確認問題を学習上の証拠として扱い、必要な補足を自動生成・自動審査して本編へ戻ります。

現在はMVPの要件確定段階です。開発リポジトリはprivateで運用し、MVP完成後のユーザビリティ評価と公開準備を経てOSS化します。

## ドキュメント

- [MVP要件定義](./REQUIREMENTS.md)
- [機能フロー](./docs/FLOWS.md)
- [実装計画とIssue一覧](./docs/IMPLEMENTATION_PLAN.md)
- [初期設計仕様 v0.2](./aituber_lecture_spec_v0.2.html)
- [ADR 0001: ワークスペースと境界](./docs/adr/0001-workspace-and-boundaries.md)
- [Course Package Contract v1](./docs/contracts/course-package-v1.md)
- [ローカル保存とイベント再生](./docs/storage.md)

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

- server: `http://127.0.0.1:4310`
- classroom: `http://127.0.0.1:4311`
- operator: `http://127.0.0.1:4312`

品質ゲートは `pnpm check` で、lint、型検査、単体試験、全ワークスペースのビルドを順に実行します。
