# 先生の声と教室素材（2026-09-15）

## 声

方向性は、明るく明瞭な、大人のお姉さん寄りのアニメ調。公開モデルの説明だけではアニメ声らしさを断定せず、同じ授業文で比較する。

`pnpm preview:voices` で `.data/voice-preview/` に3つのタイムスタンプ付き音声と manifest.json を生成する。実際の授業と同じ Fish Audio provider / s2.1-pro-free / 予算管理を通す。APIキーは既存のローカル設定を使用する。

| 候補 | Voice ID | 意図 |
| --- | --- | --- |
| あかり | 97eda32449cf443bbc4b8782853ca554 | 明るく表情豊か。今回の暫定候補 |
| しおり | 5da7f24e9e274f91b2b677669c818ce9 | 柔らかく穏やかな比較対象 |
| きょうこ | b2d9d8db057042688a5e318b8f405bc2 | 従来の声、比較基準 |

Fish Audio の `GET /model?language=ja&licensed=true` で3件とも licensed=true を確認。名前・説明は提供元によるもの。実際の声質の採否は試聴で判断する。
https://docs.fish.audio/api-reference/endpoint/model/list-models

ローカル `.env` の `AITUBER_FISH_AUDIO_VOICE_ID` を「あかり」に変更済み。サーバーが起動時に読む設定なので、現在進行中の授業には影響せず、次回起動から有効。標準フォールバックや他の導入環境の設定は変更しない。キャッシュには voiceId が含まれるため別の声の音声とは混同しない。

2026-09-15: 3候補の音声生成に成功。音声は約19〜22秒。ローカル比較用MP3も作成。機械的に生成成功と音声デコードを確認した段階であり、主観的な声質の評価は未確定。

## 教室

第一候補: Christophe Seux の Classroom（Blender公式、CC0）。
https://www.blender.org/download/demo-files/

公式配布ZIPを `.data/environment-source/classroom.zip` に取得済み。
https://download.blender.org/demo/test/classroom.zip

同梱 ReadMe により、classroom.blend に本体・粉塵・ボリューム光の3シーンがあり、assets フォルダのリンク素材を使う構成を確認。現行のWeb教室にはまだ差し替えていない。

取り込み順序:
1. assets の参照を解決し、本体シーンだけを扱う。床・黒板・窓・壁・照明を残し、先生の移動レーンにある机を除く。
2. Cycles 向けの材質をWeb用PBRに変換・必要な箇所をベイクし、GLBとして書き出す。粉塵・ボリュームは初回対象から外す。
3. 現行のスライド投影面と独立した黒板メモ面を、新しいセットの位置に合わせる。
4. 正面・左右斜め前の3視点で教材の可読性、先生の遮蔽、床への接地、移動レーンを実画面で検証する。
5. 読込サイズとフレーム時間を計測してから既定セットを差し替える。

ユーザー提示の日本式教室は無料のblend配布。公開商品説明にはアプリへの再配布条件の記述がないため候補として保持する。
https://booth.pm/ja/items/5502135
