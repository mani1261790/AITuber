# ローカル保存とイベント再生

MVPは `LectureEventStore` を単一のSQLite書込み元として使う。SQLiteはWAL、foreign keys、`synchronous=FULL`で開く。

## 書込み

- 授業イベントはevent ID、session ID、Course Package IDと版、epoch、seq、発生時刻、種類、JSON payloadを持つ。
- 同じevent IDと同じ内容の再送は成功済みとして扱い、行と進捗を増やさない。
- 同じIDの異なる内容、seqの飛び越し、古いepoch、教材版の不一致は拒否する。
- イベント追加とsessionの`last_seq`更新は同じトランザクションで行う。どちらかが失敗した場合は両方を戻す。

## 再生

最新のスナップショットを初期状態とし、その地点より後のイベントを `(epoch, seq)` 順にreducerへ渡す。epoch更新後はseqを1から再開する。スナップショットがない場合は、渡された初期状態から全イベントを再生する。

## バックアップ

稼働中のDBファイルを直接コピーしない。`LectureEventStore.backup(destination)` がSQLite online backup APIを使って、WAL中の確定済み内容を含む整合したバックアップを作る。復元試験ではバックアップを新しいstoreとして開き、session、event、snapshot再生を確認する。
