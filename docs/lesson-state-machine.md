# 講義状態機械

`@aituber/lesson` はUI、HTTP、SQLite、LLM、TTSへ依存しない純粋なreducerとして講義を進める。初期状態と同じイベント列から、同じ状態を再現する。

## 完了と取消し

Teaching Unitは `UNIT_PRESENTED` では完了しない。対応する `UNIT_AUDIO_COMPLETED` を現在のepochで受け取った時だけ完了リストへ移し、次の単位を選ぶ。

停止または障害時はepochを1増やし、再生準備済みの印を消す。古いepochのLLM、TTS、表示完了イベントは状態を変えず `stale_epoch` として無視する。未来のepochは保存状態との不整合として拒否する。

## Provider呼び出し

`pendingProviderActions` は `IDLE`、`PAUSED`、`FINISHED` で常に空配列を返す。待機中の定期生成は行わない。`PREPARING` と `BRANCHING` の明示状態だけが、教材準備または補足準備を要求できる。
