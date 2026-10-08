# 無料モーション素材の追加調査 — 2026-10-08

## 調査範囲と結果

ユーザー提供のChatGPT調査文を起点に、配布元、利用条件、現行コード、既存採用品と照合した。history IDの会話自体を取得したものではない。

14本（2,338,864 bytes）のVRMAをローカルへ取得し、アニメーションの長さ、チャンネル、指のトラックの変化を確認した。**現行先生モデルでの映像比較は未実施。採用品としての合格判定・本番への追加・デプロイは行っていない。**

取得先は `.data/motion-research-2026-10-08/candidates/`。再取得用URL、固定コミット、SHA-256、測定値は [候補マニフェスト](motion-research-candidates-2026-10-08.json) に保存した。

## 現行との違い

現在は Three.js / three-vrm / AnimationMixer。Unityではない。

`apps/classroom/src/teacher-motion.ts` は Quaterniusの会話、既存待機、Mesh2Motionの女性歩行・傾聴・左右90度回転を読み込む。上半身マスク、姿勢遷移、接地補正、視線制約、発話強度に応じた動作は既に存在する。これらを未実装とみなして別エンジンへ全面移行する必要はない。

不足を補いやすいのは **歩き始め・停止** と **指差しの開始・維持・終了** の専用クリップ。素材を増やすだけでは、足滑り、衣装貫通、複数処理が同じ関節を上書きする問題は解消しない。

既存の `docs/motion-selection.json` には挨拶、頷き、お辞儀、後退、横歩きなども残る。過去の221クリップ調査には重複や講義に不向きで除外した動きも含まれ、全てを新候補として復活させない。

## 候補の優先順位

| 優先 | 候補 | 判断 |
|---|---|---|
| 1 | Hanami内のOverte由来VRMA | 歩行の開始・停止、指差しの一連の動作、指付き会話を比較する。対象素材はApache-2.0。 |
| 2 | Sachi VRMA 1 | CC0の待機・会話を比較。今回取得した2本には指トラックなし。 |
| 3 | 既存の未採用ジェスチャー | 挨拶・頷き等を現在の衣装で再評価。移動系の改善を優先する。 |
| 4 | fumi2kickのCC0セット | 挨拶・応援が候補。小道具依存、土下座、段差動作は当面不要。 |
| 保留 | VRoid公式、Mixamo、独自規約の待機 | 無料利用と素材ファイルのWeb配信・再配布は分けて確認する。 |
| 後段 | Text-To-VRMA / ARDY、StreamTalk、vroom | 事前生成・選別の研究候補。現在の問題に対し大型モデルの導入を先行させない。 |

一次資料：

- [Hanami VRMA一覧](https://github.com/Undi95/Hanami/blob/main/vrma/README.md)、[素材ごとのNOTICE](https://github.com/Undi95/Hanami/blob/main/vrma/NOTICE.md)。アプリ本体はAGPL-3.0で素材とは別。全素材がApacheという意味ではない。今回の12本はNOTICEのOverte枠に対応する。配布時は著作権・Apache本文・NOTICE・変更履歴を保持する。Hanami側で補正済みの素材であり、上流FBXの無加工コピーではない。
- [Sachi VRMA 1](https://booth.pm/ja/items/6412084)、[VoxAvatarの素材出典](https://github.com/SanHsien/voxavatar/blob/main/ASSET_LICENSES.md)。VoxAvatar収録13本は複数作者の選集で、全てが講義向け会話動作ではない。今回はその再配布物からSachiの2本だけ取得。
- [使いどころに困るモーションセット](https://booth.pm/ja/items/5527394)。8種、CC0。
- [VRoid公式7種](https://booth.pm/ja/items/5512385)。全身を見せる・挨拶・ピース・撃つ・回る・モデルポーズ・スクワット。紹介文の「お辞儀」はこの一覧にない。抽出できる形での再配布制限があるため、現在の公開VRMA URL方式への採用は保留。
- [Mixamo公式FAQ](https://helpx.adobe.com/creative-cloud/faq/mixamo-faq.html)、[追加規約](https://wwwimages2.adobe.com/content/dam/cc/en/legal/servicetou/Mixamo-Addl-Terms-en_US-20210623.pdf)。無料・商用利用可能という点と、生素材再配布の条件を混同しない。
- [自然な立ち待機](https://booth.pm/ja/items/8815790)。独自規約。現時点では本サービスのファイル公開方式に対する許諾を確認できていない。

## 取得・構造確認したクリップ

| ファイル | 秒 | 変化する指トラック数 |
|---|---:|---:|
| `hanami/idle.vrma` | 10.00 | 0 |
| `hanami/idle-2.vrma` | 30.03 | 0 |
| `hanami/idle-talking.vrma` | 7.10 | 23 |
| `hanami/idle-talking-4.vrma` | 10.00 | 28 |
| `hanami/nod.vrma` | 1.77 | 29 |
| `hanami/think.vrma` | 3.37 | 13 |
| `hanami/world-walk-start.vrma` | 0.40 | 30 |
| `hanami/world-walk-stop-small.vrma` | 1.27 | 30 |
| `hanami/world-walk.vrma` | 1.00 | 0 |
| `hanami/world-point-in.vrma` | 0.67 | 13 |
| `hanami/world-point-hold.vrma` | 2.67 | 4 |
| `hanami/world-point-out.vrma` | 1.13 | 13 |
| `sachi/idle-01.vrma` | 7.97 | 0 |
| `sachi/speaking-01.vrma` | 1.97 | 0 |

「変化する」は出力アクセサの成分幅が1e-4を超えるもの。トラックの存在だけでなく変化を調べたが、指の形の自然さ、全フレームの数値健全性、現行モデルとの適合性を保証する検査ではない。

HanamiのREADMEは姿勢の違いが大きいモーション群を別系統として扱っている。素材名が同じ用途でも安易に混ぜない。まず同じ系統の待機→会話→移動を比較し、現在の女性歩行を残す案とも同じ条件で見比べる。

## 生成系・実装参考の位置づけ

- [Text-To-VRMA](https://github.com/Kirakun0328/text-to-vrma)：MITのツール。LLMキーフレーム生成とARDY経由。コードのMITは重み等の利用条件を置き換えない。
- [ARDY](https://github.com/nv-tlabs/ardy)：コードApache-2.0、重みはNVIDIA Open Model Agreement。上流の検証環境はCUDA GPU中心で、依存エンコーダ等にも別条件がある。ローカル事前制作候補。
- [StreamTalk](https://github.com/Xiangyue-Zhang/StreamTalk)：音声駆動ジェスチャーの研究実装。コードMITでもSMPL-Xや依存データの条件は別。VRM向けリターゲットが必要。
- [vroom](https://github.com/ProjectKokage/vroom)：HY-Motion出力からVRMAへ変換。MPS対応はあるが、モデルの容量・計算量が消えるわけではない。出力に指・顔・視線のアニメーションがなく、今回の指差し改善を単独では満たさない。モデル側はHY-Motion固有の条件。
- [AIRI animation.ts](https://github.com/moeru-ai/airi/blob/main/packages/stage-ui-three/src/composables/vrm/animation.ts)：微動作処理の参照先。既存の視線・まばたき処理と重複させない。

## 次の実装・比較順序

1. ラボに候補選択を追加し、同一モデル・画角・再生速度で現行と比較する。最初は歩行3本、指差し3本を優先。
2. 移動を開始→歩行ループ→停止へ分ける。ルート移動速度・歩幅・接地位相を合わせる。停止素材の終了だけを待って足を滑らせない。大きな運動量を前提とする長い停止素材は後回し。
3. 指差しを腕を上げる→対象を指す→戻すへ分ける。準備・復帰は素材、保持中の上中下と左右の対象合わせは既存補正を使う。手首・人差し指も確認。
4. 会話・傾聴・頷きを追加比較する。文の区切りで選択し、同じ動作の連発を避ける。既存の高水準の行動指示を使い、別の判断モデルを増やす必要はない。
5. ブレンドを調整する。0.2〜0.5秒は試験開始値であり万能の固定値ではない。脚とルートは移動処理、腕は選択中のジェスチャー、頭と目は注意・視線処理が所有し、上書きの競合を防ぐ。

## 合格条件と比較条件

合格条件は、方向・関節の反転や瞬間移動がないこと、足の接地が破綻しないこと、上中下の指差しが判別できること、衣装・体・髪への目立つ貫通がないこと、教材を隠さないこと。素材の豊富さでこれらの不合格を相殺しない。

比較するのは、お淑やかな立ち方、自然な歩数・速度、指の表情、繰り返し感の少なさ。現行v9を基準に、待機→会話→頷き→左右への回転と歩行→上中下の指差し→待機を動画で残す。正面・斜め・講義画角を使い、接地の移動量、関節のフレーム間変化、フレーム時間も併記する。コード検査や静止画だけで採用完了とはしない。

## 同日追記：ラボへの試験導入

ユーザーの試用指示を受け、14本と3つの連続動作を「追加モーション候補」に追加した。`?motion-lab&mode=trials` で直接開ける。講義本編の動作選択は変更していない。

- VRMAプレビューの古いモデル固定を解消し、v9を含むモデル選択に対応。
- 開始・維持・終了を順番に再生し、最大0.25秒で境界をブレンド。素材単体も選択可能。
- 再生速度、一時停止、再開始、全身／手元画角。髪の簡易衝突と固定刻みシミュレーションも適用。
- 歩行と指差しの連続フレームを確認。指差しは人差し指を立てるが、向きは素材の正面であり、黒板の任意対象を指す補正は未適用。
- 歩行はその場での素材比較。世界座標の移動距離・足の接地との適合は本編導入前の検証事項。待機には足の開きがあり、お淑やかな立ち姿の合格とはしていない。
- 動画：`output/playwright/motion-trials/sequences.webm`。連続動作3種の完了をブラウザで確認。素材が動くことと講義への採用合格は区別する。
- ローカル確認：関連11テスト、変更ファイルのlint、classroom型検査・ビルド成功。

配布素材は `apps/classroom/public/models/motions/research/`。Apache本文、Hanamiの素材NOTICE、Sachiの出典を同梱した。

追加比較では、Overte会話Bに胸の前で両手を使う説明動作を確認し、優先候補とした。Sachiの2本は足幅が狭い一方、腕が外に開く姿勢が目立ち、そのままの本編採用は保留。全候補はラボで比較できる状態を維持する。

一時停止でアニメーション時刻が固定されること、390×844での操作配置も確認した。狭い画面で状態表示が顔に重なったため、表示領域を3Dキャンバスから分離した。
