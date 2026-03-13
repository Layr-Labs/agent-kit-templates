export const SCHEMA = `
  CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY,
    platform_id TEXT NOT NULL,
    content_id TEXT,
    text TEXT NOT NULL,
    image_url TEXT,
    video_url TEXT,
    article_url TEXT,
    reference_id TEXT,
    type TEXT NOT NULL DEFAULT 'flagship',
    signature TEXT,
    signer_address TEXT,
    posted_at INTEGER NOT NULL,
    likes INTEGER DEFAULT 0,
    shares INTEGER DEFAULT 0,
    comments INTEGER DEFAULT 0,
    views INTEGER DEFAULT 0,
    engagement_checked_at INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    type TEXT NOT NULL,
    data TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_posts_posted_at ON posts(posted_at);
  CREATE INDEX IF NOT EXISTS idx_events_created_at ON events(created_at);
`
