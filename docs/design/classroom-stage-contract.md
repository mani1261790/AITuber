# AITuber 学習スタジオ デザイン契約

- **Artifact and medium:** AITuberの受講者向けWeb教室と授業運営画面
- **Ownership:** AITuber固有のデザイン。外部の企業ブランド、Liberka Design-Quality、Liberkaのトークンや資産を採用しない
- **Audience and usage environment:** LAN内で講義を視聴・運営する1〜5人。高校・大学レベルの内容、1080p表示、タブレット、スマートフォンを含む
- **Central purpose:** 教室では現在説明している概念、教材、板書、字幕へ集中する。運営画面では教材と時間を決め、開始後は進行状態と例外操作だけを確認する
- **Visual concept:** 「夜の学習スタジオ」。濃紺の放送空間、温かい紙色の講義面、橙のライブ状態、青紫の選択状態を使う
- **Typography:** 本文と数式周辺はZen Kaku Gothic New、進行値と短い英字ラベルはIBM Plex Monoをローカル配信する。数式はSTIX Two Mathを優先する
- **Composition:** 教室は講義ヘッダー、紙面状のステージ、連続する字幕帯、学習目標と質問対象のレールで構成する。運営画面は設定と進行モニターを並べた制御卓とする
- **Tone:** 子ども向けの玩具調や一般的なSaaSダッシュボードに寄せず、専門用語と数式を落ち着いて読める密度にする
- **Information provenance:** 表示内容、対象名、数式は検証済みCourse Packageから取得する。画面固有の架空学習結果は表示しない
- **Components:** 標準HTMLの見出し、region、button、list、formを用い、講義固有の意味ID選択ステージを実装する
- **States:** 通常、focus visible、hover、selected、字幕更新、講義中、一時停止、完了。選択は色に加えて輪郭、左側のマーカー、「選択中」の文字とaria-pressedを併用する
- **Accessibility:** DOMと視覚の読み順を一致させる。全対象をキーボードで選択でき、live字幕を提供し、色・位置・音だけに依存しない
- **Responsive:** 320、375、414、768、1024、1440pxと200% zoomで、教室の右レールと運営画面の二列を一列へ再構成し、横スクロールを出さない。長い数式だけ領域内スクロールを許す
- **Motion:** ライブ点滅以外は短い色・輪郭変化に限定し、reduced motionではアニメーションとtransitionを停止する
- **Performance:** CSSとReact DOMで描画し、連続的な背景処理や毎フレーム生成を使わない。1080pで30fpsを妨げない
- **Privacy:** 実利用者データ、顔、視線、音声を表示または取得しない
- **Validation:** pnpm check、実ブラウザの375px、768px、1440px表示、キーボード選択、意味ID解決、安全なDOM、Liberka参照の不在を確認する
