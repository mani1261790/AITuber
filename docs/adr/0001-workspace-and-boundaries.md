# ADR 0001: ワークスペースとアーキテクチャ境界

- 状態: 採用
- 日付: 2026-09-13

## 決定

Node.js 22、TypeScript、React、pnpm workspaceを基盤とする。ブラウザー画面は `apps/classroom` と `apps/operator`、常駐HTTP・WebSocketプロセスは `apps/server` に置く。

ドメイン機能は次のパッケージへ分離する。

- `contracts`: 外部入力と内部メッセージの版付き契約と検証
- `lesson`: 講義状態、教授判断、決定的な状態遷移
- `presentation`: 板書、意味ID、同期、取消し
- `content`: 教材版、根拠、抽出、検索
- `providers`: LLMと音声Providerの交換可能な接続
- `storage`: SQLite、イベント、スナップショット、ローカルファイル

依存の向きはアプリからパッケージへ向ける。`lesson` と `contracts` はReact、HTTP、WebSocket、SQLite、Provider SDKへ依存させない。ネットワークやフレームワーク固有の値はアプリ境界でドメイン契約へ変換する。

## 理由

授業の停止、再開、補足、本編への再接続は、UIやProviderの応答タイミングに左右されず再生・試験できる必要がある。単一ホストと単一状態更新元を保ちつつ、表示、AI、保存を境界の外へ置くことで、MVPの構成を小さく保つ。

## ローカル起動

1. Node.js 22とpnpm 10を用意する。
2. `pnpm install` を実行する。
3. `.env.example` を `.env` へコピーし、使用する接続情報を設定する。
4. `pnpm dev` でserver、classroom、operatorを起動する。
5. 変更確認には `pnpm check` を使う。

初期ポートはserver 4310、classroom 4311、operator 4312とする。LAN公開は教室参加を実装するIssue #10で、安全な既定値とともに追加する。
