import { describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { InMemoryDoubtRepository } from "./doubts/repository.js";
import { FakeMatchingClient, MatchingClient } from "./matching/client.js";

const validBody = {
  authorUserId: "11111111-1111-1111-1111-111111111111",
  title: "why does this integral diverge",
  description: "stuck on the improper integral in section 4",
  expertiseLevelId: "22222222-2222-2222-2222-222222222222",
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
  });

  it("rejects with a missing field", async () => {
    const app = buildApp();
    const { title, ...rest } = validBody;
    const res = await app.inject({ method: "POST", url: "/doubts", payload: rest });
    expect(res.statusCode).toBe(400);
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

  async function seedDoubt(repo: InMemoryDoubtRepository, expertiseLevelId: string, title: string) {
    return repo.create({
      authorUserId: validBody.authorUserId,
      title,
      description: "desc",
      expertiseLevelId,
    });
  }

  it("400s with no expertiseLevelIds", async () => {
    const app = buildApp();
    const res = await app.inject({ method: "GET", url: "/feed" });
    expect(res.statusCode).toBe(400);
  });

  it("returns exact-only results when the matching client finds nothing related", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, levelA, "exact match doubt");
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}` });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toHaveLength(1);
    expect(body[0].matchType).toBe("exact");
  });

  it("includes related doubts tagged and ranked after exact ones", async () => {
    const repo = new InMemoryDoubtRepository();
    await seedDoubt(repo, levelA, "exact doubt");
    await seedDoubt(repo, levelRelated, "related doubt");
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
    await seedDoubt(repo, levelA, "doubt a");
    await seedDoubt(repo, levelB, "doubt b");
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
    await seedDoubt(repo, levelA, "exact doubt");
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
    await seedDoubt(repo, levelA, "doubt 1");
    await seedDoubt(repo, levelA, "doubt 2");
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=0` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(1);
  });

  it("clamps limit above 50 down to the maximum of 50 and caps total results at limit", async () => {
    const repo = new InMemoryDoubtRepository();
    for (let i = 0; i < 5; i++) {
      await seedDoubt(repo, levelA, `doubt ${i}`);
    }
    const app = buildApp(repo, new FakeMatchingClient());

    const res = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=999` });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toHaveLength(5);

    const res2 = await app.inject({ method: "GET", url: `/feed?expertiseLevelIds=${levelA}&limit=3` });
    expect(res2.json()).toHaveLength(3);
  });
});
