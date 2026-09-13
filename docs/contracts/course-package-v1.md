# Course Package Contract v1

Course Packageは、教材生成系と講義実行核の間に置く版付きのデータ契約である。正本となるランタイムスキーマは `packages/contracts/src/course-package.ts` に置く。

## 境界

- `schemaVersion` は契約形式、`version` は同じ教材の改訂番号を表す。
- `contentHash` と各sourceのハッシュで、保存対象と参照元を識別する。
- `available` になった版は変更せず、変更は同じIDの大きい版として保存する。
- すべてのオブジェクトは未知フィールドを拒否し、配列と文字列に上限を持つ。
- スキーマ検査後に、ID重複、参照先、schedule、問題形式などの横断整合性を検査する。
- 検証済みオブジェクトは再帰的にfreezeし、実行中の偶発的な変更を防ぐ。

## 意味ID

scene、数式、画像、図、文章領域、Teaching Unitなどは、人が読める安定IDを使う。IDは小文字英字で始まり、小文字英数字と `. _ : -` だけで構成する。座標や配列番号をIDに含めない。

例:

- `scene.vertex`
- `target.formula.completed-square`
- `unit.vertex.explanation`

意味IDは画面サイズや描画位置から独立しており、質問、ポインタ、字幕同期、再接続の共通参照になる。

## 検証API

- `parseCoursePackage(input)` はスキーマと参照を検査し、freeze済みの値を返す。
- `assertCoursePackageRevision(previous, candidate)` は検証に加え、利用可能版の直接変更と版番号の後退を拒否する。
- `CoursePackageValidationError.issues` はJSON Pointer形式のpathと問題内容を返す。

## v1の上限

MVPで必要な規模を超える入力を早期に拒否するため、source 64件、学習目標32件、scene 256件、意味対象2,048件、Teaching Unit 1,024件、確認問題256件、事前補足256件を上限とする。上限変更はスキーマ版または互換性評価を伴う変更として扱う。
