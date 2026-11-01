CREATE TABLE games (
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL,
  required INTEGER NOT NULL,
  PRIMARY KEY (guild_id, name)
);

-- ゲームの必要人数は募集時点の値を複製して持つ。後で /game add で人数を変えても進行中の募集は変わらない
CREATE TABLE recruitments (
  id TEXT PRIMARY KEY,
  guild_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  game TEXT NOT NULL,
  required INTEGER NOT NULL,
  date TEXT NOT NULL,
  recruiter_id TEXT NOT NULL,
  notified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- hour が NULL の行は「今日はパス」
CREATE TABLE entries (
  recruitment_id TEXT NOT NULL REFERENCES recruitments(id),
  user_id TEXT NOT NULL,
  hour INTEGER,
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (recruitment_id, user_id)
);
