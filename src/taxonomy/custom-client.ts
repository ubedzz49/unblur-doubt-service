import { logger } from "../logger.js";

export interface CreateCustomExpertiseResult {
  expertiseTypeId: string;
  expertiseLevelId: string;
  typeName: string;
  levelName: string;
}

export interface TaxonomyClient {
  createCustom(authToken: string, subjectName: string): Promise<CreateCustomExpertiseResult>;
}

const REQUEST_TIMEOUT_MS = 2000;

// calls the User Service's /expertise-options/custom, forwarding the caller's own auth token --
// doubt-service has no service credential of its own for this endpoint, it just relays the real
// user's Authorization header. Like HttpInferenceClient, this has no fallback: if it fails there
// is no expertiseLevelId to create the doubt with, so it throws and the /doubts handler responds
// 502.
export class HttpTaxonomyClient implements TaxonomyClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.USER_SERVICE_URL ?? "") {
    this.baseUrl = baseUrl;
  }

  async createCustom(authToken: string, subjectName: string): Promise<CreateCustomExpertiseResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = new URL("/expertise-options/custom", this.baseUrl);
      const res = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: authToken,
        },
        body: JSON.stringify({ subjectName }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`user service returned non-ok response: ${res.status}`);
      }

      return (await res.json()) as CreateCustomExpertiseResult;
    } catch (err) {
      logger.warn({ err }, "expertise-options/custom call failed or timed out");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// test-only
export class FakeTaxonomyClient implements TaxonomyClient {
  public calls: Array<{ authToken: string; subjectName: string }> = [];

  constructor(
    private result:
      | CreateCustomExpertiseResult
      | (() => CreateCustomExpertiseResult) = {
      expertiseTypeId: "type-1",
      expertiseLevelId: "level-1",
      typeName: "General",
      levelName: "General",
    },
  ) {}

  async createCustom(authToken: string, subjectName: string): Promise<CreateCustomExpertiseResult> {
    this.calls.push({ authToken, subjectName });
    return typeof this.result === "function" ? this.result() : this.result;
  }
}
