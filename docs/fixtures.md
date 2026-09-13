# MVP検証教材

AI Providerがなくても、講義実行、表示、質問分岐、確認問題を再現できる固定Course Packageを `@aituber/content` から提供する。すべてCourse Package Contract v1を通してfreezeした値である。

| Fixture | 対象 | 本編時間 | 検証する表現・動作 |
|---|---|---:|---|
| `quadraticFunctionsFixture` | 高校数学I | 345秒 | 数式、放物線の模式グラフ、部分式の意味ID、短答計算問題、符号の事前補足 |
| `dnaReplicationFixture` | 高校生物 | 355秒 | 文章、酵素の模式図、手順、5'→3'、選択問題、岡崎フラグメントの事前補足 |
| `vaeReparameterizationFixture` | 大学・機械学習 | 360秒 | 確率分布、再パラメータ化式、前提の連鎖、ELBO、異なる深さからの補足と再接続 |

各教材には質問と画面切替の試験用として最大120秒の余裕を置く。3本の本編1,060秒と余裕360秒の合計は1,420秒（23分40秒）で、25分以内に収まる。

## 固定source

教材の入力sourceは `tests/fixtures/sources` に置く。各Course Packageのsource hashはファイルの実SHA-256と一致することを試験する。sourceはこのリポジトリ用に作成した内容として `owned` を設定している。

## 質問と再接続

`fixtureQuestionScenarios` は、質問した直後のTeaching Unit、利用する事前補足、期待する本編復帰先を固定する。VAEは前提説明直後から`epsilon`へ戻る経路と、変換式の説明後から勾配説明へ戻る経路を別シナリオにし、複数段階の再接続試験に使う。

## 変更規則

- 表示対象のIDを座標や配列番号へ置き換えない。
- sourceを変更した場合は実SHA-256とCourse Packageの版を更新する。
- 本編時間を変更した場合は、6分前後と3本25分以内の両方を再検証する。
- 科目固有の内容を共通契約へ押し込まず、`kind`と意味IDで既存の表示能力へ割り当てる。
