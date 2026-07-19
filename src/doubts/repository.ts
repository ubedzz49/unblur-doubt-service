export type DoubtStatus = "open" | "resolved" | "closed";

export interface Doubt {
  id: string;
  authorUserId: string;
  title: string;
  description: string;
  expertiseLevelId: string;
  status: DoubtStatus;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
}

export interface CreateDoubtInput {
  authorUserId: string;
  title: string;
  description: string;
  expertiseLevelId: string;
}

export interface DoubtRepository {
  create(input: CreateDoubtInput): Promise<Doubt>;
  getById(id: string): Promise<Doubt | null>;
  updateStatus(id: string, status: DoubtStatus): Promise<Doubt | null>;
  listByAuthor(authorUserId: string): Promise<Doubt[]>;
  // open doubts for the given expertise levels, newest first
  listOpenByLevels(expertiseLevelIds: string[]): Promise<Doubt[]>;
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
      description: input.description,
      expertiseLevelId: input.expertiseLevelId,
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

  async listOpenByLevels(expertiseLevelIds: string[]): Promise<Doubt[]> {
    const levelSet = new Set(expertiseLevelIds);
    return Array.from(this.rows.values())
      .filter((d) => d.status === "open" && levelSet.has(d.expertiseLevelId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
}
