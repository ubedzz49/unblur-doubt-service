export type DoubtStatus = "open" | "resolved" | "closed";

export interface Doubt {
  id: string;
  authorUserId: string;
  title: string;
  description: string | null;
  expertiseLevelIds: string[];
  status: DoubtStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreateDoubtInput {
  authorUserId: string;
  title: string;
  description?: string;
  expertiseLevelIds: string[];
}

// optional feed filters, applied on top of the expertiseLevelIds/status match
export interface FeedFilters {
  // free-text substring match against title OR description, case-insensitive
  topic?: string;
  // ISO 8601 date/datetime string -- only doubts created on/after this instant
  createdAfter?: string;
}

export interface DoubtRepository {
  create(input: CreateDoubtInput): Promise<Doubt>;
  getById(id: string): Promise<Doubt | null>;
  updateStatus(id: string, status: DoubtStatus): Promise<Doubt | null>;
  listByAuthor(authorUserId: string): Promise<Doubt[]>;
  // doubts that have any of the given expertise levels tagged, for the given status, newest
  // first, optionally narrowed by topic/createdAfter filters
  listByLevels(expertiseLevelIds: string[], status: DoubtStatus, filters?: FeedFilters): Promise<Doubt[]>;
}

function matchesFilters(doubt: Doubt, filters: FeedFilters | undefined): boolean {
  if (!filters) return true;

  if (filters.topic) {
    const needle = filters.topic.toLowerCase();
    const haystack = `${doubt.title} ${doubt.description ?? ""}`.toLowerCase();
    if (!haystack.includes(needle)) return false;
  }

  if (filters.createdAfter) {
    if (new Date(doubt.createdAt).getTime() < new Date(filters.createdAfter).getTime()) return false;
  }

  return true;
}

// test-only -- avoids CI needing real Postgres
export class InMemoryDoubtRepository implements DoubtRepository {
  private rows = new Map<string, Doubt>();

  async create(input: CreateDoubtInput): Promise<Doubt> {
    const now = new Date().toISOString();
    const doubt: Doubt = {
      id: crypto.randomUUID(),
      authorUserId: input.authorUserId,
      title: input.title,
      description: input.description ?? null,
      expertiseLevelIds: Array.from(new Set(input.expertiseLevelIds)),
      status: "open",
      createdAt: now,
      updatedAt: now,
      resolvedAt: null,
    };
    this.rows.set(doubt.id, doubt);
    return doubt;
  }

  async getById(id: string): Promise<Doubt | null> {
    return this.rows.get(id) ?? null;
  }

  async updateStatus(id: string, status: DoubtStatus): Promise<Doubt | null> {
    const existing = this.rows.get(id);
    if (!existing) return null;
    const updated: Doubt = {
      ...existing,
      status,
      updatedAt: new Date().toISOString(),
      resolvedAt: status === "resolved" ? new Date().toISOString() : existing.resolvedAt,
    };
    this.rows.set(id, updated);
    return updated;
  }

  async listByAuthor(authorUserId: string): Promise<Doubt[]> {
    return Array.from(this.rows.values())
      .filter((d) => d.authorUserId === authorUserId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async listByLevels(expertiseLevelIds: string[], status: DoubtStatus, filters?: FeedFilters): Promise<Doubt[]> {
    const levelSet = new Set(expertiseLevelIds);
    return Array.from(this.rows.values())
      .filter(
        (d) => d.status === status && d.expertiseLevelIds.some((id) => levelSet.has(id)) && matchesFilters(d, filters),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
