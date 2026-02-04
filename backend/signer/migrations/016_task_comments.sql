-- Task comments: allow users and agents to comment on tasks
-- Auth: wallet signature (web users) or API key (agents)

CREATE TABLE IF NOT EXISTS task_comments (
  id SERIAL PRIMARY KEY,
  task_id INTEGER NOT NULL,
  author_address VARCHAR(42) NOT NULL,
  content TEXT NOT NULL,
  is_agent BOOLEAN DEFAULT false,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_task_comments_task_id ON task_comments(task_id);
CREATE INDEX idx_task_comments_author ON task_comments(author_address);
CREATE INDEX idx_task_comments_created ON task_comments(task_id, created_at);
