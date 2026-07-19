-- A doubt can now be tagged with more than one subject/expertise level. Move from the
-- singular doubts.expertise_level_id column to a join table.
CREATE TABLE IF NOT EXISTS doubt_expertise_levels (
  doubt_id UUID NOT NULL REFERENCES doubts(id) ON DELETE CASCADE,
  -- soft reference to user-service's expertise_levels.id, same caveat as doubts.expertise_level_id
  -- used to have: same physical DB but a different service's table, so no cross-db FK here
  expertise_level_id UUID NOT NULL,
  PRIMARY KEY (doubt_id, expertise_level_id)
);

-- feed query's reverse lookup: given a level id, find doubts tagged with it
CREATE INDEX IF NOT EXISTS idx_doubt_expertise_levels_level
  ON doubt_expertise_levels (expertise_level_id);

-- pre-launch data, no real users yet -- safe to backfill and drop the old column outright
-- rather than run a dual-write migration period.
INSERT INTO doubt_expertise_levels (doubt_id, expertise_level_id)
SELECT id, expertise_level_id FROM doubts WHERE expertise_level_id IS NOT NULL
ON CONFLICT DO NOTHING;

ALTER TABLE doubts DROP COLUMN IF EXISTS expertise_level_id;

-- no more auto-detection, so this flag is meaningless now
ALTER TABLE doubts DROP COLUMN IF EXISTS auto_detected;
