import Fastify, { FastifyInstance } from "fastify";
import { CreateDoubtInput, Doubt, DoubtRepository, DoubtStatus, FeedFilters, InMemoryDoubtRepository } from "./doubts/repository.js";
import { FakeMatchingClient, MatchingClient } from "./matching/client.js";
import { FeedCache, InMemoryFeedCache } from "./cache/feed-cache.js";

interface CreateDoubtBody {
  authorUserId?: string;
  title?: string;
  description?: string;
  expertiseLevelId?: string;
}

interface UpdateStatusBody {
  status?: DoubtStatus;
}

interface ListByAuthorQuery {
  authorUserId?: string;
}

interface FeedQuery {
  expertiseLevelIds?: string;
  limit?: string;
  topic?: string;
  createdAfter?: string;
  status?: string;
}

type FeedEntry = Doubt & { matchType: "exact" | "related" };

const DEFAULT_FEED_LIMIT = 20;
const MIN_FEED_LIMIT = 1;
const MAX_FEED_LIMIT = 50;
// doubts are created far less often than the feed is read, so a short cache window trades a
// little staleness for meaningfully less read load on Postgres. No invalidation-on-write: a
// newly created doubt can take up to this long to appear in a cached feed response.
const FEED_CACHE_TTL_SECONDS = 30;
const VALID_STATUSES: DoubtStatus[] = ["open", "resolved", "closed"];

export function buildApp(
  doubtRepository: DoubtRepository = new InMemoryDoubtRepository(),
  matchingClient: MatchingClient = new FakeMatchingClient(),
  feedCache: FeedCache<FeedEntry> = new InMemoryFeedCache<FeedEntry>(),
): FastifyInstance {
  const app = Fastify({
    logger: process.env.NODE_ENV === "test" ? false : { level: process.env.LOG_LEVEL ?? "info" },
  });

  app.get("/healthz", async () => ({ status: "ok" }));

  app.post<{ Body: CreateDoubtBody }>("/doubts", async (request, reply) => {
    const { authorUserId, title, description, expertiseLevelId } = request.body ?? {};
    if (!authorUserId || !title || !description || !expertiseLevelId) {
      request.log.warn("create doubt rejected: missing required field");
      return reply.code(400).send({ error: "authorUserId, title, description and expertiseLevelId are required" });
    }

    const input: CreateDoubtInput = { authorUserId, title, description, expertiseLevelId };
    const doubt = await doubtRepository.create(input);
    request.log.info({ doubtId: doubt.id }, "doubt created");
    return reply.code(201).send(doubt);
  });

  app.get<{ Params: { id: string } }>("/doubts/:id", async (request, reply) => {
    const doubt = await doubtRepository.getById(request.params.id);
    if (!doubt) {
      return reply.code(404).send({ error: "doubt not found" });
    }
    return reply.send(doubt);
  });

  app.patch<{ Params: { id: string }; Body: UpdateStatusBody }>("/doubts/:id/status", async (request, reply) => {
    const { status } = request.body ?? {};
    if (status !== "resolved" && status !== "closed") {
      return reply.code(400).send({ error: "status must be 'resolved' or 'closed'" });
    }

    const existing = await doubtRepository.getById(request.params.id);
    if (!existing) {
      return reply.code(404).send({ error: "doubt not found" });
    }

    // only an open doubt can transition -- resolved/closed are terminal
    if (existing.status !== "open") {
      return reply.code(409).send({ error: `doubt is already ${existing.status}` });
    }

    const updated = await doubtRepository.updateStatus(request.params.id, status);
    request.log.info({ doubtId: request.params.id, status }, "doubt status updated");
    return reply.send(updated);
  });

  app.get<{ Querystring: ListByAuthorQuery }>("/doubts", async (request, reply) => {
    const { authorUserId } = request.query;
    if (!authorUserId) {
      return reply.code(400).send({ error: "authorUserId is required" });
    }
    const doubts = await doubtRepository.listByAuthor(authorUserId);
    return reply.send(doubts);
  });

  app.get<{ Querystring: FeedQuery }>("/feed", async (request, reply) => {
    const { expertiseLevelIds, topic } = request.query;
    if (!expertiseLevelIds) {
      return reply.code(400).send({ error: "expertiseLevelIds is required" });
    }

    const status = (request.query.status ?? "open") as DoubtStatus;
    if (!VALID_STATUSES.includes(status)) {
      return reply.code(400).send({ error: "status must be one of 'open', 'resolved', 'closed'" });
    }

    const { createdAfter } = request.query;
    if (createdAfter !== undefined && Number.isNaN(new Date(createdAfter).getTime())) {
      return reply.code(400).send({ error: "createdAfter must be a valid ISO 8601 date/datetime string" });
    }

    const requestedLimit = Number(request.query.limit ?? DEFAULT_FEED_LIMIT);
    const limit = Number.isFinite(requestedLimit)
      ? Math.min(Math.max(Math.trunc(requestedLimit), MIN_FEED_LIMIT), MAX_FEED_LIMIT)
      : DEFAULT_FEED_LIMIT;

    const exactLevelIds = expertiseLevelIds
      .split(",")
      .map((id) => id.trim())
      .filter(Boolean);
    const exactLevelSet = new Set(exactLevelIds);

    const filters: FeedFilters = {};
    if (topic) filters.topic = topic;
    if (createdAfter) filters.createdAfter = createdAfter;

    const cacheKey = buildFeedCacheKey(exactLevelIds, status, filters, limit);
    const cached = await feedCache.get(cacheKey);
    if (cached) {
      request.log.debug({ cacheKey }, "feed cache hit");
      return reply.send(cached);
    }
    request.log.debug({ cacheKey }, "feed cache miss");

    const exactDoubts = await doubtRepository.listByLevels(exactLevelIds, status, filters);
    const exactIds = new Set(exactDoubts.map((d) => d.id));
    const exactTagged = exactDoubts.map((d) => ({ ...d, matchType: "exact" as const }));

    // related expansion is best-effort -- matching service being down degrades to exact-only,
    // per MATCHING_SERVICE.md's documented fallback contract
    const relatedLevelIds = new Set<string>();
    for (const levelId of exactLevelIds) {
      try {
        const related = await matchingClient.getRelatedLevelIds(levelId, limit);
        for (const id of related) {
          if (!exactLevelSet.has(id)) relatedLevelIds.add(id);
        }
      } catch (err) {
        request.log.warn({ levelId, err }, "matching client threw, skipping related expansion for this level");
      }
    }

    let relatedTagged: FeedEntry[] = [];
    if (relatedLevelIds.size > 0) {
      const relatedDoubts = await doubtRepository.listByLevels(Array.from(relatedLevelIds), status, filters);
      relatedTagged = relatedDoubts.filter((d) => !exactIds.has(d.id)).map(tagRelated);
    }

    const feed = [...exactTagged, ...relatedTagged].slice(0, limit);
    request.log.info({ exactCount: exactTagged.length, relatedCount: relatedTagged.length }, "feed built");

    await feedCache.set(cacheKey, feed, FEED_CACHE_TTL_SECONDS);

    return reply.send(feed);
  });

  function tagRelated(doubt: Doubt): FeedEntry {
    return { ...doubt, matchType: "related" as const };
  }

  return app;
}

// deterministic key from every input that affects the result, so distinct queries never
// collide in the shared cache
function buildFeedCacheKey(
  expertiseLevelIds: string[],
  status: DoubtStatus,
  filters: FeedFilters,
  limit: number,
): string {
  const sortedLevelIds = [...expertiseLevelIds].sort().join(",");
  const topic = filters.topic ?? "";
  const createdAfter = filters.createdAfter ?? "";
  return `feed:v1:${sortedLevelIds}:${status}:${topic}:${createdAfter}:${limit}`;
}
