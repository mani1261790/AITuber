# 動画入りPDFの試作対応

PDF 2.0のRichMediaとして埋め込まれたMP4をPDF.jsから読み出し、元のページの上に合成します。文字・図・ページ配置は既存のPDF描画を使用します。PDF全機能への対応を意味しません。

## 対応条件

- MP4（H.264、音声を使う場合はAAC）、PDFにファイル本体を埋め込む。
- 1素材50MB以下、1ページ8素材まで。同一ページの動画は区別できるファイル名にする。
- PDFのスクリプト、外部動画URL、Flashの実行は対象外。
- 台本の `performance.units[].beats[].media` で再生区間を指定。現在はJSON指定で、教材編集画面の専用入力は未実装。
- `media` のない既存教材の動作は変わらない。動画があっても指定区間がなければ再生しない。

```json
{"media":[{"id":"video-cue","filename":"motion.mp4","start":0,"end":12,"quote":"台本内の正確な選択文字列","muted":false}]}
```

`start`・`end` は台本中のUTF-16文字位置、endは終端を含まない。実際のquoteと一致させる。読み上げのアラインメントから区間の開始・終了時刻を求める。選択区間の先頭で動画を0秒から再生し、区間末尾または動画末尾で停止する。文字列や音声アラインメントが一致しない場合は再生しない。異なる台本区間への動画の続きの持ち越しは未対応。

講義音声の実再生位置を基準に動画を同期する。スライド説明中の一時停止では、現在の説明と音声位置を保存して再開する。黒板準備や移動途中の一時停止は従来の復帰動作を使用する。講義管理からのMP4出力はフレーム単位のバックグラウンド描画に変更した。手順は `OFFLINE_MP4.md` を参照。以下の録画手順と測定結果は旧リアルタイム方式の検証記録。

## 試作を再実行する

プロジェクトルートで:

```sh
uv venv /tmp/aituber-pdf-media-env
uv pip install --python /tmp/aituber-pdf-media-env/bin/python pypdf reportlab numpy
/tmp/aituber-pdf-media-env/bin/python scripts/create-richmedia-fixture.py
pnpm build
node scripts/serve-pdf-media-demo.mjs
```

ffmpegが必要。ポート4446でローカル起動する。承認済み参照音源を使い、音声キャッシュがなければ環境変数 `FISH_API_KEY` を渡す。キーは資料やGitに保存しない。既存の `output/pdf-media/audio-cache` があればAPIへのリクエストは不要。

```sh
curl -s http://127.0.0.1:4446/api/sessions \
  -H 'Content-Type: application/json' \
  -d '{"coursePackageId":"pdf-richmedia-prototype","durationMinutes":2,"videoExport":true}'
```

返された `classroom.code` で `http://127.0.0.1:4446/?code=CODE&export=mp4` をChromeで開く。MP4書き出しを開始し、動画再生中に一時停止→再開し、最後まで収録する。UI操作は録画に含まれない。

## 2026-11-03の確認

- ローカルChromeで2ページを最後まで再生。最終状態FINISHED、2/2単元。
- 「いま、動画を再生します」の区間（音声約4.6秒）から開始。
- 約2.5秒の一時停止中、動画は2.07008秒で固定。再開直後との差は約16ms。
- MP4は1280×720、H.264/AAC、約28.3秒。ffmpeg全編デコードでエラーなし。
- MP4のフレームに動画を確認。音声の880Hz検査信号も収録されていることを周波数解析で確認。
- 関連テスト7ファイル98件、全体ビルド、変更箇所のESLintを通過。

記録: `output/pdf-media/verification.json`、`telemetry.json`、`PDF動画・同期検証.mp4`。
本番へのデプロイ、iPad実機、Acrobatでの再生互換性はこの検証には含まない。任意のPDFを自動で動画付き台本にする生成プロンプトや、教材編集画面の動画区間指定は別途対応する。
