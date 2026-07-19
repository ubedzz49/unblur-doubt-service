# unblur-doubt-service

Doubt posting + feed. Owns the `doubts` table. Calls out to `unblur-matching-service` for
semantic "related expertise" expansion when building the feed, but degrades gracefully to
exact-tag matching if that call fails or times out — semantic expansion is an enhancement, not
a hard dependency (see `MATCHING_SERVICE.md`).

Shares the same RDS Postgres instance and database as `unblur-user-service` and
`unblur-matching-service` (pragmatic reuse of existing infra) but owns and only touches its own
`doubts` table, never the `users`/`expertise_*` tables.

Redis-backed feed caching was deliberately deferred for this first version — the feed query is a
straightforward indexed lookup today, and caching can be added later if it proves slow under
real load rather than guessed at up front.

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
