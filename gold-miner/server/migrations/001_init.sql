CREATE TABLE IF NOT EXISTS scores (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  mode        TEXT    NOT NULL CHECK (mode IN ('solo','versus')),
  name        TEXT    NOT NULL,
  score       INTEGER NOT NULL CHECK (score >= 0),
  rounds      INTEGER NOT NULL CHECK (rounds BETWEEN 1 AND 8),
  character   TEXT    NOT NULL,
  created_at  INTEGER NOT NULL,          -- 服务器时间,Unix 毫秒
  version     INTEGER NOT NULL           -- 规则版本(第二阶段为 2)
);
CREATE INDEX IF NOT EXISTS idx_scores_rank ON scores (mode, score DESC, created_at);
