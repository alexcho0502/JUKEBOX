-- JUKEBOX database schema (Cloudflare D1 / SQLite)
-- D1 콘솔에 이 내용을 그대로 붙여넣고 실행하면 됩니다.

CREATE TABLE IF NOT EXISTS users (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  nickname     TEXT NOT NULL UNIQUE COLLATE NOCASE,
  salt         TEXT NOT NULL,
  pin_hash     TEXT NOT NULL,
  failed       INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

-- kind: 'music' | 'film'
-- source: 'fav' (내 목록에 담은 작품) | 'found' (추천에서 찾은 작품)
-- type: 'album' | 'track' | 'film'
CREATE TABLE IF NOT EXISTS items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind       TEXT NOT NULL,
  source     TEXT NOT NULL,
  ukey       TEXT NOT NULL,
  title      TEXT NOT NULL,
  artist     TEXT NOT NULL DEFAULT '',
  year       TEXT NOT NULL DEFAULT '',
  type       TEXT NOT NULL DEFAULT '',
  cover      TEXT,
  link       TEXT,
  rating     REAL,
  pos        INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  UNIQUE (user_id, kind, source, ukey)
);
CREATE INDEX IF NOT EXISTS items_feed ON items(kind, created_at DESC);
CREATE INDEX IF NOT EXISTS items_user ON items(user_id, kind, source, pos);

CREATE TABLE IF NOT EXISTS messages (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  to_user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  from_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body         TEXT NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS messages_to ON messages(to_user_id, created_at DESC);

-- 요청 횟수 제한용 카운터 (로그인 시도, 추천 요청, 방명록)
CREATE TABLE IF NOT EXISTS usage (
  k   TEXT PRIMARY KEY,
  n   INTEGER NOT NULL,
  exp INTEGER NOT NULL
);
