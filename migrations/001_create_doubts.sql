-- Shares the same RDS instance and database as unblur-user-service and unblur-matching-service
-- (pragmatic reuse of existing infra) -- but this service owns and only touches the doubts
-- table, never the users/expertise_* tables.
CREATE TABLE IF NOT EXISTS doubts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  -- soft reference to user-service's users.id -- same physical DB but a different service's
  -- table, so no cross-db FK here
  author_user_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  -- soft reference to user-service's expertise_levels.id, same caveat as above
  expertise_level_id UUID NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'closed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ NULL
);

-- feed query shape: open doubts for a given level, newest first
CREATE INDEX IF NOT EXISTS idx_doubts_level_status_created
  ON doubts (expertise_level_id, status, created_at DESC);
