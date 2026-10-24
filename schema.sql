-- 回報資料庫（Cloudflare D1）。照片以 BLOB 存在 photos 表，事件表只存照片編號。
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL,
  role TEXT NOT NULL,
  kind TEXT,
  nickname TEXT,
  note TEXT,
  vendor TEXT,
  result TEXT,
  at TEXT NOT NULL,
  pts INTEGER DEFAULT 0,
  verify TEXT,
  photo_id TEXT,
  ip TEXT,
  hidden INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_events_tree ON events(tree_id);
CREATE INDEX IF NOT EXISTS idx_events_at ON events(at);
CREATE INDEX IF NOT EXISTS idx_events_ip ON events(ip, at);
CREATE TABLE IF NOT EXISTS photos (
  id TEXT PRIMARY KEY,
  data BLOB NOT NULL,
  created TEXT NOT NULL
);
