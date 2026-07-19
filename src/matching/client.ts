import { logger } from "../logger.js";

export interface MatchingClient {
  getRelatedLevelIds(levelId: string, limit?: number): Promise<string[]>;
}

const REQUEST_TIMEOUT_MS = 2000;

// calls the Matching Service's /match/related-expertise. Per MATCHING_SERVICE.md's documented
// failure mode: semantic expansion is an enhancement, never a hard dependency -- any error or
// timeout here degrades to an empty result rather than throwing, so the feed just falls back
// to exact-tag matching.
export class HttpMatchingClient implements MatchingClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.MATCHING_SERVICE_URL ?? "") {
    this.baseUrl = baseUrl;
  }

  async getRelatedLevelIds(levelId: string, limit?: number): Promise<string[]> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = new URL("/match/related-expertise", this.baseUrl);
      url.searchParams.set("levelId", levelId);
      if (limit) url.searchParams.set("limit", String(limit));

      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        logger.warn({ levelId, status: res.status }, "matching service returned non-ok response, degrading to []");
        return [];
      }

      const body = (await res.json()) as Array<{ expertiseLevelId: string }>;
      return body.map((r) => r.expertiseLevelId);
    } catch (err) {
      logger.warn({ levelId, err }, "matching service call failed or timed out, degrading to []");
      return [];
    } finally {
      clearTimeout(timeout);
    }
  }
}

// test-only
export class FakeMatchingClient implements MatchingClient {
  constructor(private relatedByLevel: Record<string, string[]> = {}) {}

  async getRelatedLevelIds(levelId: string): Promise<string[]> {
    return this.relatedByLevel[levelId] ?? [];
  }
}
