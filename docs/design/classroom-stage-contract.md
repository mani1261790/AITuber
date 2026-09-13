# 教室ステージ デザイン契約

- **Artifact and medium:** AITuber受講者画面のWebステージ
- **Consumer and adopted Design-Quality version:** AITuber、Liberka Design-Quality 5.3.1、revision `4b92f4412424f92c0e78a15834e3d2b6deb59077`
- **Audience and usage environment:** LAN内で講義を視聴する1〜5人。1080p表示とスマートフォンを含む
- **Central purpose:** 現在説明している概念、教材、板書、字幕を追い、必要な箇所を質問対象として選ぶ
- **Reading order:** 講義状態、講義名と現在概念、教材・板書、字幕、質問対象一覧
- **Information provenance:** 表示内容、対象名、数式は検証済みCourse Packageから取得する。画面固有の架空学習結果は表示しない
- **Profile and tokens:** 製品Profileなし。Liberka Core/WebのInk、Canvas、Surface、Border、Brand Primary/Softトークンを使用
- **Components:** AITuberのapproved catalogは未登録。標準HTMLの見出し、region、button、listを用い、講義固有の意味ID選択ステージを実装する
- **States:** 通常、focus visible、hover、selected、字幕更新。選択は下線、輪郭、対象名と `aria-pressed` を併用
- **Accessibility:** DOMと視覚の読み順を一致させる。全対象をキーボードで選択でき、live字幕を提供し、色・位置・音だけに依存しない
- **Responsive:** 320、375、414、768、1024、1440pxと200% zoomで、二列を一列へ再構成し横スクロールを出さない。長い数式だけ領域内スクロールを許す
- **Motion:** 状態変化は色・輪郭中心。非本質的な移動を使わず、reduced motionではtransitionを停止
- **Performance:** CSSとReact DOMで描画し、連続アニメーションや毎フレーム生成を使わない。1080pで30fpsを妨げない
- **Privacy:** 実利用者データ、顔、視線、音声を表示または取得しない
- **Validation:** `pnpm check`、実ブラウザーのdesktop/mobile表示、キーボード選択、意味ID解決、安全なDOMを確認
- **Exception:** なし
