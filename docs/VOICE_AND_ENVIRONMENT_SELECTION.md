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

## 追記: アニメ声への変更と教室の実装

ユーザーの「もっとアニメ声」「教室は差し替え」の指示により、ローカル声設定を `4a56e31b2ec54484972040592c8ba7e2`（Anime voice）へ変更。比較用の高音候補は `af5846c4409241f3be2d51525a295d34`（Anime）。`pnpm preview:voices anime-teacher anime-bright` で再生成できる。両方とも提供元で日本語・女性・アニメ調のタグが付く公開モデルであり、licensed=true の公式認可モデルではない。ローカル試用の設定で、配布時の標準ボイスには採用していない。

https://fish.audio/m/4a56e31b2ec54484972040592c8ba7e2/
https://fish.audio/m/af5846c4409241f3be2d51525a295d34/

教室を `classroom-realistic.glb` に差し替え。Blender 4.5 による変換スクリプトは `scripts/convert-classroom.py`。元のCyclesノードをそのままベイクしたものではなく、元画像を使用したWeb用PBR材質へ再構成している。壁・腰壁・窓枠・地図・照明などを残し、元の黒板と教卓周辺の物を除去。教材の投影面とライブ補足用の黒板は別々のまま維持。描画失敗時は既存の簡易セットを表示する。

実機確認: 教室コード KAGTU8 で新GLBの読込を確認。旧セットの代替表示ではなく `classroom-seux` を表示。先生右側・右斜め前カメラで教材遮蔽なし、文書全体の縦スクロールなし、ブラウザーconsoleエラーなし。新しいVoice IDでFish Audio音声を生成し、ブラウザーaudioが再生中であることも確認。型・lint・172テスト・build・client boundary・self-host acceptanceを通過。GLBは約19.1MB、337,672三角形、33マテリアルプリミティブ。PCローカルでの表示確認であり、低性能端末や低速回線の性能保証ではない。
