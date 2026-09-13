# 音声、字幕、取消し

## 授業タイムライン

Teaching Unitの `speechText` に長い語を優先して読み辞書を適用し、その確定文字列をFish Audioへ送り、同じ文字列を教室の字幕へ表示する。Fish Audioのタイムスタンプはサーバーで絶対ミリ秒へ変換し、各区間へTeaching Unitの意味IDを付ける。教室はサーバーの `startedAt` から再生位置を補正し、100ms間隔で該当する全意味IDを強調する。音声中はタイムラインの強調を優先し、音声区間の外では視聴者が質問用に選んだ対象へ戻す。

一時停止または終了ではAbortSignalで進行中のTTSを取り消し、音声URLをセッション表示から除く。音声取得APIもセッション、epoch、現在の音声を照合し、ブラウザーへ `no-store` を返すため、以前のURLは取得・再利用できない。結果が後から返っても、開始時のepoch、Teaching Unit、講義状態が一致しなければ捨てる。TTSが失敗した場合は、同じ確定文字列の字幕をTeaching Unitの想定発話時間だけ表示して講義を続ける。

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

APIキーを設定して `pnpm measure:tts` を実行する。数学の式、DNA関連の固有名詞、VAEの英字・ギリシャ文字、複数分野をつないだ長文を合成し、Fishから最初の音声チャンクを受け取るまでの時間、成果物全体が再生可能になるまでの時間、音声時間、バイト数、タイムスタンプ区間数とOpus音声を `.data/fish-audio-measurements` に保存する。前二つはそれぞれ `firstAudioChunkMs` と `artifactReadyMs` であり、ブラウザ側のネットワーク・デコード時間を含まない。

標準音声の固定には、生成した4音声を実際に聴き、日本語の自然さ、数式・英字・固有名詞の読み、長文の声質と切れ目を確認する。現在の作業環境にはFish AudioのAPIキーがないため、外部APIの実測値と候補音声の採否は未確定である。

## 故障注入

`AITUBER_TTS_TEST_MODE=tone` で有効なWAV音声とタイムスタンプを返し、ブラウザーの音声配信・再生・強調を外部APIなしで確認できる。`AITUBER_TTS_TEST_MODE=failure` ではTTS失敗を注入し、字幕継続を確認できる。これらは検証専用で、通常設定や運営画面には表示しない。

## ローカル基準機での計測

2026-09-14にChromeと固定テスト音声を使い、停止POSTの開始から教室の音声要素が除去されるまでを20回測定した。p95は101ms、最大102msで、NFR-01の250ms以内を満たした。音声の再生位置と、字幕・意味ID強調に使う授業時計の絶対差を100ms間隔で20点測定した結果、p95は195ms、最大195msで、NFR-04の300ms以内を満たした。これはローカル開発環境の結果であり、Fish Audioの外部合成時間は含まない。
