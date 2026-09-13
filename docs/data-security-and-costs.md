# データ保持、費用予約、入力防御

## 7日保持

個人に結び付く授業の生データはローカルSQLiteだけに保存する。サーバー起動時と、その後1時間ごとに保持処理を実行する。最後の授業イベント、質問、学習証拠、ライブ補足、授業後回答、アンケートのいずれも7日以上更新されていないセッションを一単位として削除する。これにより、再生に必要な関連行だけが欠ける状態を作らず、授業後回答やアンケートの直後に古いセッションを削除することも避ける。

削除対象は、授業セッション、イベント、板書スナップショット、質問と投稿者ID、学習証拠、ライブ補足と生成・審査試行、授業後回答と生成・審査試行、任意アンケートである。TTS音声とメタデータのキャッシュもファイル更新時刻から7日後に削除する。費用予約の行も同じ期間で削除する。

MVPには分析SDK、テレメトリー、外部分析送信を入れない。データは同じインストール内だけで扱う。LLMとTTSへの送信は、授業機能そのものを実行するために明示されたProviderエンドポイントだけで行う。

## 呼出前の費用予約

LLMとTTSの実呼出より先にSQLiteで最大利用量と最大費用を予約する。予約と当日の合計確認は`BEGIN IMMEDIATE`の一つのトランザクションなので、同時要求や別プロセスからの要求でも、確認と追加の間に上限をすり抜けない。

台帳は教材作成の`authoring`と、授業・ライブ補足・授業後回答・音声の`runtime`を分ける。日付はUTC日で区切る。LLMは入力本文、system instruction、JSON Schema、画像、最大出力と1回の再試行を含む保守的な上限を予約する。Providerが利用量を返さない場合や途中で失敗した場合にも安全側を保つため、予約した最大費用をその日の使用枠として維持する。TTSは送信文字数から予約する。キャッシュ命中では外部TTSを呼ばないため、新しい予約も作らない。

費用が0のローカル・無料Providerにも資源上限を適用する。既定値は教材作成LLMが1日100,000,000 token、授業時LLMが10,000,000 token、授業時TTSが1,000,000文字である。LLMの値は実token数ではなく、事前に安全側へ見積もった予約量である。

外部LLMでは入力・出力単価と該当する1日上限の両方が必要である。値がなければ呼出を始めない。Ollamaなどのloopback接続は自動的に0 USD、Fish Audioの`s2.1-pro-free`も0 USDとして扱う。それ以外のFishモデルは文字単価が必要になる。

```dotenv
AITUBER_LLM_INPUT_USD_PER_MILLION_TOKENS=
AITUBER_LLM_OUTPUT_USD_PER_MILLION_TOKENS=
AITUBER_AUTHORING_DAILY_BUDGET_USD=
AITUBER_RUNTIME_DAILY_BUDGET_USD=
AITUBER_TTS_USD_PER_MILLION_CHARACTERS=
AITUBER_AUTHORING_DAILY_LLM_TOKEN_LIMIT=100000000
AITUBER_RUNTIME_DAILY_LLM_TOKEN_LIMIT=10000000
AITUBER_RUNTIME_DAILY_TTS_CHARACTER_LIMIT=1000000
```

単価はProviderの現在の公表値を管理者が設定する。コード側で有料モデルの価格やモデルを推測して切り替えない。

## 秘密情報

APIキーはサーバーの環境変数または権限600の`.data/llm-settings.json`だけに置く。設定APIは`apiKeyConfigured`だけを返し、キーそのものを返さない。ブラウザーのVite設定は`AITUBER_LAN_`で始まる変数だけを読む。`pnpm verify:client-boundaries`は秘密値を入れたビルドを作り、教室・運営の成果物へ混入しないことと、外部分析SDKが依存にないことを検査する。

## 非信頼入力

- 教材は1回につき1〜16ファイル、合計24 MiBまで。PDF・Markdown・テキストは1件20 MiB、画像は1件10 MiBまでとする。
- PDFは500ページまでとし、PDF・PNG・JPEG・WebPは宣言MIMEとファイル署名の一致を確認する。
- ファイル名は正規化し、区切り文字、`.`、`..`、制御文字を拒否する。展開後テキストは1件350 KB、合計400 KBまでとする。
- 通常のJSON本文は64 KiB、教材作成本文は28 MiBまでとする。
- 教材、質問、生成候補はLLMへ非信頼データとして渡し、生成と審査を別contextにする。contextにはツール権限やProvider設定を与えず、JSON Schemaとサーバー側の参照・計算・描画検査を通過した値だけを採用する。
- 数式は4,096文字までとし、外部リンク・画像、HTML拡張、マクロ定義、再帰展開に使えるTeX命令をCourse Package受入時とライブ差分適用時に拒否する。ブラウザー側でもKaTeXの`trust: false`、`strict: error`、展開数・寸法上限を維持する。
- テキストはReactのテキストノードとして表示し、教材由来のHTML、SVG、script、外部資源を実行しない。
