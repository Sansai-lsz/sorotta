-- NULL は定員なし
ALTER TABLE games ADD COLUMN max_players INTEGER;

ALTER TABLE recruitments ADD COLUMN scope TEXT NOT NULL DEFAULT 'night';
ALTER TABLE recruitments ADD COLUMN max_players INTEGER;
ALTER TABLE recruitments ADD COLUMN status TEXT NOT NULL DEFAULT 'open';
-- ⚙ や自動締め切りは interaction token なしで投稿を書き換えるので、bot token で叩けるよう ID を持つ
ALTER TABLE recruitments ADD COLUMN message_id TEXT;

-- 既存の募集の投稿は旧形式のボタンしか持たず、新しい custom_id では受け付けられないため締め切り扱いにする
UPDATE recruitments SET status = 'closed';

-- 旧形式の回答は時間帯を持たず、新しい集計では読めない
DROP TABLE entries;

-- id は最初に回答した順で、定員を超えたときの補欠の判定に使う。
-- 回答し直しても変わらないよう、行は ON CONFLICT DO NOTHING で作り INSERT OR REPLACE は使わない
CREATE TABLE participants (
  id INTEGER PRIMARY KEY,
  recruitment_id TEXT NOT NULL REFERENCES recruitments(id),
  user_id TEXT NOT NULL,
  passed INTEGER NOT NULL DEFAULT 0,
  anytime INTEGER NOT NULL DEFAULT 0,
  UNIQUE (recruitment_id, user_id)
);

-- 深夜の hour は 24〜29
CREATE TABLE slots (
  recruitment_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  bucket TEXT NOT NULL,
  hour INTEGER NOT NULL,
  is_now INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (recruitment_id, user_id, bucket)
);
