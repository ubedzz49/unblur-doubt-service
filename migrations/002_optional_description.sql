-- Description is not always meaningful to write -- make it optional.
ALTER TABLE doubts ALTER COLUMN description DROP NOT NULL;

-- Tracks doubts created via the "auto-detect" flow, where the subject/level was inferred by
-- the Matching Service (and possibly newly created in the User Service's taxonomy) rather than
-- picked directly by the author.
ALTER TABLE doubts ADD COLUMN IF NOT EXISTS auto_detected BOOLEAN NOT NULL DEFAULT false;
