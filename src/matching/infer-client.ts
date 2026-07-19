import { logger } from "../logger.js";

export type InferExpertiseResult =
  | { matched: true; expertiseTypeId: string; expertiseLevelId: string; label: string; similarity: number }
  | { matched: false; suggestedLabel: string };

export interface InferenceClient {
  inferExpertise(title: string, description?: string): Promise<InferExpertiseResult>;
}

const REQUEST_TIMEOUT_MS = 2000;

// calls the Matching Service's /match/infer-expertise. Unlike HttpMatchingClient's related-
// expertise lookup, this is NOT a best-effort enhancement -- it is the only source of a subject
// when the caller opted into auto-detect, so there is no reasonable fallback if it fails. Any
// error or timeout here throws, and the /doubts handler turns that into a 502 rather than
// silently skipping auto-detect.
export class HttpInferenceClient implements InferenceClient {
  private baseUrl: string;

  constructor(baseUrl = process.env.MATCHING_SERVICE_URL ?? "") {
    this.baseUrl = baseUrl;
  }

  async inferExpertise(title: string, description?: string): Promise<InferExpertiseResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    try {
      const url = new URL("/match/infer-expertise", this.baseUrl);
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, description }),
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`matching service returned non-ok response: ${res.status}`);
      }

      return (await res.json()) as InferExpertiseResult;
    } catch (err) {
      logger.warn({ err }, "infer-expertise call failed or timed out");
      throw err;
    } finally {
      clearTimeout(timeout);
    }
  }
}

// test-only
export class FakeInferenceClient implements InferenceClient {
  constructor(private result: InferExpertiseResult | (() => InferExpertiseResult) = { matched: false, suggestedLabel: "General" }) {}

  async inferExpertise(): Promise<InferExpertiseResult> {
    return typeof this.result === "function" ? this.result() : this.result;
  }
}
