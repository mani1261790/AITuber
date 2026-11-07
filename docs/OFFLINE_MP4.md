# バックグラウンドMP4出力

講義管理 → 教材 → MP4出力 →「バックグラウンドで書き出す」。開始後は管理画面を閉じられる。再度開くと進捗・中止・ダウンロードを操作できる。授業セッションを開始せず、保存済み教材を複製して使用するため、書き出し中の教材編集はそのジョブに影響しない。練習問題・コメント欄・操作ボタンは収録しない。

## 実行環境

Node版AITuberサーバー、ローカルGoogle Chrome、ffmpeg、ffprobeが必要。`pnpm build` 後に通常のNodeサーバーを起動する。FishAudioなど、サーバーの音声設定と参照音源設定を引き継ぐ。既存音声キャッシュも使用する。描画用PCは電源を入れ、スリープを避ける。ユーザー側のブラウザーや端末の描画速度には依存しないが、描画用PCの性能は完成までの時間に影響する。

Cloudflare Workers単体ではNode子プロセス・Chrome・ffmpegを実行しない。Cloudflare本番管理画面は末尾のCloudflare接続を通じてNode描画サービスへジョブを渡す。以下の初回検証はローカルで行い、その後の本番検証は別記する。

既定保存先 `.data/video-exports`。`AITUBER_VIDEO_EXPORT_DIR` で変更可能。ffmpeg/ffprobeの実行ファイルは `FFMPEG_PATH` / `FFPROBE_PATH` で指定できる。描画は同時1件、最大30分、1280×720・30fps、H.264/AAC。最終MP4は512MB以下。音声準備中のサーバー停止は失敗扱い。描画開始後は独立した子プロセスで動き、ファイルに状態を保存する。失敗を自動で連続再試行しない。

## 本番のクラウド書き出し

Cloudflareが教材を固定してR2に保存し、このリポジトリの `render-mp4.yml` を指定ジョブIDで一度だけ起動する。GitHubホストのUbuntuでChromeとffmpegを実行し、MP4を認証付きでR2に戻す。常駐PCや定期起動は不要。既存の音声・描画・容量上限を使い、中止後は結果を受け付けない。

Actions secret `RENDER_DISPATCH_TOKEN` にはこのリポジトリに限定した fine-grained token（Actions: read/write）を設定してデプロイする。アカウント全体のCLIトークンは使用しない。`RENDER_AGENT_TOKEN` は実行機とCloudflare間の別の認証。受付に失敗したときは管理画面から再度開始できる。ジョブが異常終了して受付に残った場合は「中止」で解除できる。

## 処理と同期

1. 保存済みの台本・元PDF・読み方・指差し指定をジョブに固定する。単元をまたいで黒板/スライドの状態を引き継いで動作列に変換する。
2. 発話音声と文字単位の時間情報を準備する。
3. 非表示のChromeで既存の教室/VRMを読み込む。モデル・フォント・PDF・シェーダーが準備できてから描画を始める。
4. 時刻を `フレーム番号 / 30` として1フレームずつ進める。動作・口の動き・指差しを同じ時刻で評価する。埋め込み動画は該当時刻へシークし、デコード完了後に合成する。実時間の待ち時間で台本を進めず、フレームを飛ばさない。
5. 連番フレームをffmpegへ送り、音声を同じタイムライン上で合成する。埋め込み動画に音声がある場合は指定区間をミックスする。

MediaRecorderや画面キャプチャ、実時間の音声再生は使用しない。途中の資材読み込み・エンコード待ちは完成動画の時間に入らない。舞台動作の完了待ちは講義タイムラインに含まれる。動画の指定方法は `PDF_VIDEO.md` を参照。

## 検証の再実行

```sh
/tmp/aituber-pdf-media-env/bin/python scripts/create-richmedia-fixture.py
pnpm build
node scripts/serve-pdf-media-demo.mjs
```

`http://127.0.0.1:4446/operator/#/export/pdf-richmedia-prototype` を開く。音声キャッシュがなければ `FISH_API_KEY` が必要。試験教材は2ページの動画入りPDFを4単元で使用し、移動・動画・黒板・スライド復帰を試す。音声は技術試験用に同じ説明を再使用しており、完成教材ではない。

完了ジョブに対して:

```sh
/tmp/aituber-pdf-media-env/bin/python scripts/verify-offline-export.py output/pdf-media/exports/export.JOB_ID
```

NumPy、ffmpeg/ffprobeが必要。MP4のフレーム数、全編デコード、元音声との相関/時間差、埋め込み動画の880Hz音声、動画時刻を検査する。意図的な低速描画比較では input.json・source-*.pdf・voice-*.audio・status.json を別ディレクトリーに複製し、`AITUBER_RENDER_FRAME_DELAY_MS=30 node scripts/render-mp4-worker.mjs 別ディレクトリー` を実行する。検査スクリプトの第2引数にそのディレクトリーを渡すと、全動作イベント・音声配置・毎秒の位置/動画時刻が同じか比較する。GPUやブラウザーが異なる環境でのビット単位の映像一致は保証しない。

## 2026-11-03の検証結果

- 管理画面で開始 → ブラウザーを閉じる → 独立プロセスで完了 → 管理画面を開き直してダウンロード、を確認。
- 4単元、1,966フレーム、65.533秒。移動・動画再生・黒板描画・スライド復帰を確認。単元をまたぐ黒板→スライド復帰の不具合を修正。
- 全音声配置の原音との相関0.981以上、時間差最大5.34ms。動画音声880Hzも2区間で検出。全編デコード成功。
- 1フレームごとに30msの待ち時間を加えた場合、描画時間は48.5秒から111.4秒に延びたが、フレーム数・音声配置・全動作イベント・毎秒の講師位置と動画時刻は一致。映像のバイト列は不一致。同時刻5地点の画素平均差は0〜0.56/255で、ビット単位一致は主張しない。
- 管理画面の中止操作後、子プロセス終了とダウンロード不可を確認。
- 検証出力: `output/pdf-media/exports/export.773a1529-7170-4519-ba47-6dfb8cd251f9/` 内の `lecture.mp4`、`timeline.json`、`verification.json`。管理画面経由の取得物は `output/pdf-media/管理画面から書き出したMP4.mp4`。
- 全体ESLintには既存のstrict-course-schemaテスト、cloudflare-server-only、output内生成ファイルのエラーが残る。今回変更した実装・テスト・検証ホストのESLintは通過。

最終チェック: 全体型チェック、121ファイル731テスト、各アプリのビルド、変更実装のESLintを通過。管理画面からダウンロードしたMP4と生成元MP4のSHA-256一致を確認。中止の最終再検証は export.c84a3735-6c77-4f86-a552-cf0450553cad で、Node/ffmpeg終了とダウンロードHTTP 400を確認。

## 旧Mac描画方式の記録（2026-11-03）

`render-exports.ts` が本番の受付・進捗・中止・ダウンロードをR2で管理する。専用の `RENDER_AGENT_TOKEN` で認証されたPC側 `scripts/cloud-render-agent.mjs` が30秒おきにジョブを取得する。PCへの着信やポート公開は不要。教材は開始時に固定され、元PDFはそのジョブが参照するものだけ取得できる。進捗の更新は5秒間隔、SQLの読み取りは使わない。開始時だけ公開済み教材を講義サービスから読む。

設定ファイル `.data/render-agent.json`（0600）には `origin`, `token`, `fishApiKey`, `voiceId` を置く。値はGitに入れない。`pnpm --filter @aituber/server... build` と教室アプリのビルド後、`node scripts/cloud-render-agent.mjs` で起動する。macOSではLaunchAgentで常駐させる。PC停止中は新規開始を不可にし、途中のジョブは管理画面から中止できる。エラーを自動生成で繰り返さない。

転送は95MB以下。超過時は失敗を表示し、ローカルの完成物は `.data/cloud-exports` に残す。描画用PCは起動が必要。本番管理画面を操作する端末での描画は不要。

## 本番での確認（2026-11-03）

- 実装コミット `178e487` を本番へ反映。[デプロイと境界検証](https://github.com/mani1261790/AITuber/actions/runs/41636095015)が成功。
- MacのLaunchAgent `com.oif.aituber-render` が描画サービスを常駐実行する。
- 本番管理画面で `pdf-video-production-check-v3-20261103` の書き出しを開始し、ブラウザーを閉じた後も完了した。再度管理画面を開いてMP4をダウンロードし、生成元とのSHA-256一致を確認。
- ジョブ `export.c201dbf4-2511-401a-baba-ec16d27a7b6a`、66.233秒、1,987フレーム。音声相関0.989以上、最大時間差5.34ms。埋め込み動画の映像・880Hz検査音、黒板の数式描画、スライド復帰を確認。全編デコード成功。
- 本番に保存された動画入りPDFは元ファイルとバイト一致。未ログイン401、不正エージェント認証401、別オリジン403、重複開始409を確認。
- 利用者の承認後、既存の一時停止中講義を終了し、検証用ライブ講義を実施。動画→移動→黒板の数式→スライド復帰の4単元すべてがFINISHEDとなり、音声エラーなし。
- 移動中のスライド説明を一時停止した際の音声位置を保存し、Cloudflareのランタイム再構築後も保持するよう修正。動画の再開待ちも調整し、`ee94845` を[本番反映](https://github.com/mani1261790/AITuber/actions/runs/41642781690)。
- 本番Chromeで10.002秒の一時停止中、動画は1.703917秒の位置を保持。音声は要求位置5.531286秒から5.532秒へ再開し、動画は音声再開から25msで追従。これは今回の測定結果であり、全端末への保証ではない。
- `python3 scripts/verify-live-pdf.py output/cloud-render-verification` で実測ログを検査。`live-verification.json` に結果、`live-trace.json` にブラウザー時計の記録を保存。ライブ再生とMP4出力は別々に検証した。
- 検証成果物は `output/cloud-render-verification/`。公開URLではなく管理画面認証付きでダウンロードする。

検証教材を再登録する場合は、PDF生成とビルドの後 `node scripts/prepare-richmedia-import.mjs` で `output/pdf-media/cloud-import.json` を作る。この処理自体は送信しない。元PDF、ページプレビュー、動画参照と確認手順の資料をまとめ、ローカルで形式検査する。同じIDの二重登録は不可。取り込み時の本番審査も必要。

R2の条件付き書き込みと保存APIは[公式Workers API仕様](https://developers.cloudflare.com/r2/api/workers/workers-api-reference/)に従う。
