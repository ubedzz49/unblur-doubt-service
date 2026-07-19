import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDoubtRepository } from "./doubts/repository.js";
import { FakeMatchingClient, MatchingClient } from "./matching/client.js";
import { InMemoryFeedCache } from "./cache/feed-cache.js";

const validBody = {
  authorUserId: "11111111-1111-1111-1111-111111111111",
  title: "why does this integral diverge",
  description: "stuck on the improper integral in section 4",
  expertiseLevelIds: ["22222222-2222-2222-2222-222222222222"],
};

describe("GET /healthz", () => {
  it("returns ok status", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/healthz" });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: "ok" });
  });
});

describe("POST /doubts", () => {
  it("creates a doubt", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "POST", url: "/doubts", payload: validBody });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.status).toBe("open");
    expect(body.title).toBe(validBody.title);
    expect(body.expertiseLevelIds).toEqual(validBody.expertiseLevelIds);
    expect(body.autoDetected).toBeUndefined();
  });

  it("creates a doubt with multiple subject ids", async () => {
    const app = buildApp();
    const levelIds = [
      "22222222-2222-2222-2222-222222222222",
      "33333333-3333-3333-3333-333333333333",
    ];
    const res = await app.inject({
      method: "POST",
      url: "/doubts",
      payload: { ...validBody, expertiseLevelIds: levelIds },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.expertiseLevelIds.sort()).toEqual([...levelIds].sort());
  });

  it("dedupes duplicate ids in the input without erroring", async () => {
    const app = buildApp();
    const levelId = "22222222-2222-2222-2222-222222222222";
    const res = await app.inject({
      method: "POST",
      url: "/doubts",
      payload: { ...validBody, expertiseLevelIds: [levelId, levelId] },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().expertiseLevelIds).toEqual([levelId]);
  });

  it("rejects with a missing field", async () => {
    const app = buildApp();
    const { title, ...rest } = validBody;
    const res = await app.inject({ method: "POST", url: "/doubts", payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it("creates a doubt when description is omitted", async () => {
    const app = buildApp();
    const { description, ...rest } = validBody;
    const res = await app.inject({ method: "POST", url: "/doubts", payload: rest });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body.title).toBe(validBody.title);
    expect(body.description).toBeNull();
  });

  it("400s when description is omitted and title is also missing", async () => {
    const app = buildApp();
    const { description, title, ...rest } = validBody;
    const res = await app.inject({ method: "POST", url: "/doubts", payload: rest });
    expect(res.statusCode).toBe(400);
  });

  it("400s with the new message when expertiseLevelIds is missing", async () => {
    const app = buildApp();
    const { expertiseLevelIds, ...rest } = validBody;
    const res = await app.inject({ method: "POST", url: "/doubts", payload: rest });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("at least one expertiseLevelId is required");
  });

  it("400s when expertiseLevelIds is an empty array", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "POST",
      url: "/doubts",
      payload: { ...validBody, expertiseLevelIds: [] },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toBe("at least one expertiseLevelId is required");
  });
});

describe("GET /doubts/:id", () => {
  it("404s for an unknown id", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/doubts/does-not-exist" });
    expect(res.statusCode).toBe(404);
  });
});

describe("PATCH /doubts/:id/status", () => {
  it("moves open -> resolved and sets resolvedAt", async () => {
    const app = buildApp();
    const created = await app.inject({ method: "POST", url: "/doubts", payload: validBody });
    const id = created.json().id;

    const res = await app.inject({ method: "PATCH", url: `/doubts/${id}/status`, payload: { status: "resolved" } });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe("resolved");
    expect(body.resolvedAt).not.toBeNull();
  });

  it("moves open -> closed", async () => {
    const app = buildApp();
    const created = await app.inject({ method: "POST", url: "/doubts", payload: validBody });
    const id = created.json().id;

    const res = await app.inject({ method: "PATCH", url: `/doubts/${id}/status`, payload: { status: "closed" } });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe("closed");
  });

  it("409s on a transition from an already-resolved doubt", async () => {
    const app = buildApp();
    const created = await app.inject({ method: "POST", url: "/doubts", payload: validBody });
    const id = created.json().id;

    await app.inject({ method: "PATCH", url: `/doubts/${id}/status`, payload: { status: "resolved" } });
    const res = await app.inject({ method: "PATCH", url: `/doubts/${id}/status`, payload: { status: "closed" } });
    expect(res.statusCode).toBe(409);
  });

  it("404s for an unknown id", async () => {
    const app = buildApp();
    const res = await app.inject({
      method: "PATCH",
      url: "/doubts/does-not-exist/status",
      payload: { status: "resolved" },
    });
    expect(res.statusCode).toBe(404);
  });
});

describe("GET /doubts", () => {
  it("400s with no authorUserId", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/doubts" });
    expect(res.statusCode).toBe(400);
  });

  it("lists doubts by author", async () => {
    const app = buildApp();
    await app.inject({ method: "POST", url: "/doubts", payload: validBody });
    const res = await app.inject({ method: "GET", url: `/doubts?authorUserId=${validBody.authorUserId}` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });
});

describe("GET /feed", () => {
  const levelA = "aaaaaaaa-0000-0000-0000-000000000001";
  const levelB = "bbbbbbbb-0000-0000-0000-000000000002";
  const levelRelated = "cccccccc-0000-0000-0000-000000000003";
  const levelUnrelated = "dddddddd-0000-0000-0000-000000000004";

  async function seedDoubt(repo: InMemoryDoubtRepository, expertiseLevelIds: string[], title: string) {
    return repo.create({
      authorUserId: validBody.authorUserId,
      title,
      description: "desc",
      expertiseLevelIds,
    });
  }

  it("400s with no expertiseLevelIds", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/feed" });
    expect(res.statusCode).toBe(400);
  });

  it("returns exact-only results when the matching client finds nothing related", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA], "exact match doubt");
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchType).toBe("exact");
  });

  it("matches the feed via any one of a doubt's multiple tags, not just the first", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelUnrelated, levelA], "multi-tag doubt matching via second tag");
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchType).toBe("exact");
  });

  it("counts a doubt as exact if any one tag qualifies, even with another unrelated tag", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA, levelUnrelated], "doubt with one exact and one unrelated tag");
    // matching client claims levelUnrelated is related to nothing relevant here; the point is
    // the doubt should still be "exact" because levelA is in the viewer's set
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchType).toBe("exact");
  });

  it("includes related doubts tagged and ranked after exact ones", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA], "exact doubt");
    await seedDoubt(repo, [levelRelated], "related doubt");
    const matchingClient = new FakeMatchingClient({ [levelA]: [levelRelated] });
    const app = buildApp(repo, matchingClient);

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body[0].matchType).toBe("exact");
    expect(body[1].matchType).toBe("related");
    expect(body[1].title).toBe("related doubt");
  });

  it("does not double count a level already in the exact set as related", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA], "doubt a");
    await seedDoubt(repo, [levelB], "doubt b");
    // matching client claims levelB is related to levelA, but levelB is already requested exactly
    const matchingClient = new FakeMatchingClient({ [levelA]: [levelB] });
    const app = buildApp(repo, matchingClient);

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA},${levelB}` });
    const body = res.json();
    expect(body).toHaveLength(2);
    expect(body.every((d: { matchType: string }) => d.matchType === "exact")).toBe(true);
  });

  it("degrades gracefully to exact-only when the matching client throws", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA], "exact doubt");
    const throwingClient: MatchingClient = {
      getRelatedLevelIds: async () => {
        throw new Error("matching service unreachable");
      },
    };
    const app = buildApp(repo, throwingClient);

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchType).toBe("exact");
  });

  it("clamps limit below 1 up to the minimum of 1", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, [levelA], "doubt 1");
    await seedDoubt(repo, [levelA], "doubt 2");
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=0` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("clamps limit above 50 down to the maximum of 50 and caps total results at limit", async () => {
    const repo = new InMemoryDoubtRepository();
    for (let i = 0; i < 5; i++) {
      await seedDoubt(repo, [levelA], `doubt ${i}`);
    }
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=999` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(5);

    const res2 = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=3` });
    expect(res2.json()).toHaveLength(3);
  });

  describe("filters", () => {
    it("matches the topic filter against title or description, case-insensitively", async () => {
      const repo = new InMemoryDoubtRepository();
      await repo.create({
        authorUserId: validBody.authorUserId,
        title: "Integral calculus doubt",
        description: "stuck on convergence",
        expertiseLevelIds: [levelA],
      });
      await repo.create({
        authorUserId: validBody.authorUserId,
        title: "Linear algebra doubt",
        description: "eigenvectors are confusing",
        expertiseLevelIds: [levelA],
      });
      const app = buildApp(repo, new FakeMatchingClient());

      const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&topic=CALCULUS` });
      expect(res.statusCode).toBe(200);
      const body = res.json();
      expect(body).toHaveLength(1);
      expect(body[0].title).toBe("Integral calculus doubt");
    });

    it("excludes doubts that don't match the topic filter", async () => {
      const repo = new InMemoryDoubtRepository();
      await seedDoubt(repo, [levelA], "unrelated topic");
      const app = buildApp(repo, new FakeMatchingClient());

      const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&topic=nonexistent` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);
    });

    it("filters by createdAfter, excluding doubts created before it", async () => {
      const repo = new InMemoryDoubtRepository();
      await seedDoubt(repo, [levelA], "old doubt");
      const app = buildApp(repo, new FakeMatchingClient());

      const future = new Date(Date.now() + 60_000).toISOString();
      const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&createdAfter=${future}` });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toHaveLength(0);

      const past = new Date(Date.now() - 60_000).toISOString();
      const res2 = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&createdAfter=${past}` });
      expect(res2.json()).toHaveLength(1);
    });

    it("400s on an unparseable createdAfter", async () => {
      const app = buildApp();
      const res = await app.inject({
        method: "GET",
        url: `/feed?expertiseLevelIds=${levelA}&createdAfter=not-a-date`,
      });
      expect(res.statusCode).toBe(400);
    });

    it("defaults to open-only but allows overriding status to resolved", async () => {
      const repo = new InMemoryDoubtRepository();
      const openDoubt = await seedDoubt(repo, [levelA], "open doubt");
      const resolvedDoubt = await seedDoubt(repo, [levelA], "resolved doubt");
      await repo.updateStatus(resolvedDoubt.id, "resolved");
      const app = buildApp(repo, new FakeMatchingClient());

      const defaultRes = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
      const defaultBody = defaultRes.json();
      expect(defaultBody).toHaveLength(1);
      expect(defaultBody[0].id).toBe(openDoubt.id);

      const resolvedRes = await app.inject({
        method: "GET",
        url: `/feed?expertiseLevelIds=${levelA}&status=resolved`,
      });
      const resolvedBody = resolvedRes.json();
      expect(resolvedBody).toHaveLength(1);
      expect(resolvedBody[0].id).toBe(resolvedDoubt.id);
    });

    it("400s on an invalid status value", async () => {
      const app = buildApp();
      const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&status=bogus` });
      expect(res.statusCode).toBe(400);
    });
  });

  describe("caching", () => {
    it("a cache hit skips the repository and matching client entirely", async () => {
      const repo = new InMemoryDoubtRepository();
      await seedDoubt(repo, [levelA], "cached doubt");
      const matchingClient = new FakeMatchingClient();
      const listSpy = vi.spyOn(repo, "listByLevels");
      const relatedSpy = vi.spyOn(matchingClient, "getRelatedLevelIds");
      const cache = new InMemoryFeedCache();
      const app = buildApp(repo, matchingClient, cache);

      const url = `/feed?expertiseLevelIds=${levelA}`;
      const first = await app.inject({ method: "GET", url });
      expect(first.statusCode).toBe(200);
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(relatedSpy).toHaveBeenCalledTimes(1);

      const second = await app.inject({ method: "GET", url });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toEqual(first.json());
      // no additional repository/matching-client calls on the cache hit
      expect(listSpy).toHaveBeenCalledTimes(1);
      expect(relatedSpy).toHaveBeenCalledTimes(1);
    });

    it("a genuinely different query is a cache miss", async () => {
      const repo = new InMemoryDoubtRepository();
      await seedDoubt(repo, [levelA], "doubt a");
      await seedDoubt(repo, [levelB], "doubt b");
      const matchingClient = new FakeMatchingClient();
      const listSpy = vi.spyOn(repo, "listByLevels");
      const cache = new InMemoryFeedCache();
      const app = buildApp(repo, matchingClient, cache);

      await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
      expect(listSpy).toHaveBeenCalledTimes(1);

      await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelB}` });
      expect(listSpy).toHaveBeenCalledTimes(2);
    });

    it("re-fetches after the cache TTL expires, using the injectable clock", async () => {
      const repo = new InMemoryDoubtRepository();
      await seedDoubt(repo, [levelA], "doubt a");
      const matchingClient = new FakeMatchingClient();
      const listSpy = vi.spyOn(repo, "listByLevels");

      let now = 1_000_000;
      const cache = new InMemoryFeedCache(() => now);
      const app = buildApp(repo, matchingClient, cache);

      const url = `/feed?expertiseLevelIds=${levelA}`;
      await app.inject({ method: "GET", url });
      expect(listSpy).toHaveBeenCalledTimes(1);

      await app.inject({ method: "GET", url });
      expect(listSpy).toHaveBeenCalledTimes(1);

      now += 31_000; // past the 30s TTL
      await app.inject({ method: "GET", url });
      expect(listSpy).toHaveBeenCalledTimes(2);
    });
  });
});
