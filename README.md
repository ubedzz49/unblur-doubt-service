# unblur-doubt-service

Doubt posting + feed. Owns the `doubts` table. Calls out to `unblur-matching-service` for
semantic "related expertise" expansion when building the feed, but degrades gracefully to
exact-tag matching if that call fails or times out — semantic expansion is an enhancement, not
a hard dependency (see `MATCHING_SERVICE.md`).

Shares the same RDS Postgres instance and database as `unblur-user-service` and
`unblur-matching-service` (pragmatic reuse of existing infra) but owns and only touches its own
`doubts` table, never the `users`/`expertise_*` tables.

## Feed filters

`GET /feed` accepts optional query params on top of `expertiseLevelIds` (exact + related match):

- `topic` — free-text substring match against a doubt's title OR description, case-insensitive.
- `createdAfter` — ISO 8601 date/datetime string; only doubts created on/after this instant.
  Returns 400 if it isn't parseable.
- `status` — defaults to `open`; can also be set to `resolved` or `closed` (single value only).

## Feed caching

`GET /feed` responses are cached in Redis for 30 seconds, keyed off every input that affects the
result (expertise level ids, status, topic, createdAfter, limit). This is a deliberate tradeoff:
doubts are created far less often than the feed is read, so a short cache window meaningfully
cuts read load on Postgres at the cost of a small amount of staleness.

**There is no cache invalidation on write.** A newly created (or status-changed) doubt can take
up to 30 seconds to show up in a cached feed response. This was accepted as simple and
good-enough rather than building write-side invalidation up front.

## Local development

```bash
cp .env.example .env.local
npm install
npm run dev
```

## Scripts

- `npm run dev` — local dev server
- `npm run build` — production build
- `npm run migrate` — run pending migrations
- `npm test` — unit tests (Vitest)
