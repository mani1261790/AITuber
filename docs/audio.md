# 音声、字幕、取消し

## 授業タイムライン

Teaching Unitの `speechText` をFish Audioへ送り、同じ文字列を教室の字幕へ表示する。Fish Audioのタイムスタンプはサーバーで絶対ミリ秒へ変換し、各区間へTeaching Unitの意味IDを付ける。教室はサーバーの `startedAt` から再生位置を補正し、100ms間隔で該当する意味IDを強調する。

一時停止または終了ではAbortSignalで進行中のTTSを取り消し、音声URLをセッション表示から除く。結果が後から返っても、開始時のepoch、Teaching Unit、講義状態が一致しなければ捨てる。TTSが失敗した場合は、同じ `speechText` の字幕と固定時間で講義を続ける。

## Fish Audio接続

2026-09-14時点の公式APIでは、タイムスタンプ付きSSEエンドポイントは `POST /v1/tts/stream/with-timestamp`、推奨モデルは `s2-pro`、推奨形式は48kHz Opusである。長文では音声チャンクを到着順に連結し、同じ `chunk_seq` のalignmentは最新スナップショットで置き換える。

- [Text to Speech Stream with Timestamps](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech-stream-with-timestamps)
- [Text to Speech](https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech)

`.env` に次を設定する。画面ではProviderやモデルを選ばせない。

```dotenv
AITUBER_FISH_AUDIO_API_KEY=
AITUBER_FISH_AUDIO_MODEL=s2-pro
AITUBER_FISH_AUDIO_VOICE_ID=b2d9d8db057042688a5e318b8f405bc2
```

APIキーがない開発環境では、固定テスト音声の時計を使う。APIキーがある場合はFish Audioへ接続する。

## キャッシュ

キャッシュキーは、Provider、モデル、音声ID、読み辞書版、言語、発話文字列を順序付きでSHA-256へ入力する。音声とメタデータは `.data/tts-cache` に分離して保存する。秘密値はキーにもメタデータにも含めない。

## 標準音声の実測

実測候補はFish Officialの「きょうこ（カスタマーサポート）」である。Fish Audioの公開カタログでライセンス契約済み・商用利用可能とされ、教育、落ち着き、明瞭さのタグがあるため選んだ。音声IDは `b2d9d8db057042688a5e318b8f405bc2`。

- [きょうこ（カスタマーサポート）](https://fish.audio/m/b2d9d8db057042688a5e318b8f405bc2/)
- [Fish Audio音声カタログ](https://fish.audio/ja/discovery/)

APIキーを設定して `pnpm measure:tts` を実行する。数学の式、DNA関連の固有名詞、VAEの英字・ギリシャ文字、複数分野をつないだ長文を合成し、最初の音声チャンクまでの時間、全体時間、バイト数、タイムスタンプ区間数とOpus音声を `.data/fish-audio-measurements` に保存する。

標準音声の固定には、生成した4音声を実際に聴き、日本語の自然さ、数式・英字・固有名詞の読み、長文の声質と切れ目を確認する。現在の作業環境にはFish AudioのAPIキーがないため、外部APIの実測値と候補音声の採否は未確定である。

## 故障注入

`AITUBER_TTS_TEST_MODE=tone` で有効なWAV音声とタイムスタンプを返し、ブラウザーの音声配信・再生・強調を外部APIなしで確認できる。`AITUBER_TTS_TEST_MODE=failure` ではTTS失敗を注入し、字幕継続を確認できる。これらは検証専用で、通常設定や運営画面には表示しない。
