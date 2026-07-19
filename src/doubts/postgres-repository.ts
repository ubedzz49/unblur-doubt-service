import { Pool, PoolClient } from "pg";
import { CreateDoubtInput, Doubt, DoubtRepository, DoubtStatus, FeedFilters } from "./repository.js";

interface DoubtRow {
  id: string;
  author_user_id: string;
  title: string;
  description: string | null;
  status: DoubtStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function toDoubt(row: DoubtRow, expertiseLevelIds: string[]): Doubt {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    title: row.title,
    description: row.description,
    expertiseLevelIds,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export class PostgresDoubtRepository implements DoubtRepository {
  constructor(private pool: Pool) {}

  private async fetchLevelIds(client: Pool | PoolClient, doubtId: string): Promise<string[]> {
    const result = await client.query<{ expertise_level_id: string }>(
      `SELECT expertise_level_id FROM doubt_expertise_levels WHERE doubt_id = $1`,
      [doubtId],
    );
    return result.rows.map((r) => r.expertise_level_id);
  }

  private async fetchLevelIdsForMany(client: Pool | PoolClient, doubtIds: string[]): Promise<Map<string, string[]>> {
    const map = new Map<string, string[]>();
    if (doubtIds.length === 0) return map;
    const result = await client.query<{ doubt_id: string; expertise_level_id: string }>(
      `SELECT doubt_id, expertise_level_id FROM doubt_expertise_levels WHERE doubt_id = ANY($1)`,
      [doubtIds],
    );
    for (const row of result.rows) {
      const existing = map.get(row.doubt_id);
      if (existing) {
        existing.push(row.expertise_level_id);
      } else {
        map.set(row.doubt_id, [row.expertise_level_id]);
      }
    }
    return map;
  }

  async create(input: CreateDoubtInput): Promise<Doubt> {
    const dedupedLevelIds = Array.from(new Set(input.expertiseLevelIds));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<DoubtRow>(
        `INSERT INTO doubts (author_user_id, title, description)
         VALUES ($1, $2, $3)
         RETURNING *`,
        [input.authorUserId, input.title, input.description ?? null],
      );
      const row = result.rows[0];
      for (const levelId of dedupedLevelIds) {
        await client.query(
          `INSERT INTO doubt_expertise_levels (doubt_id, expertise_level_id) VALUES ($1, $2)`,
          [row.id, levelId],
        );
      }
      await client.query("COMMIT");
      return toDoubt(row, dedupedLevelIds);
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async getById(id: string): Promise<Doubt | null> {
    const result = await this.pool.query<DoubtRow>(`SELECT * FROM doubts WHERE id = $1`, [id]);
    if (!result.rows[0]) return null;
    const levelIds = await this.fetchLevelIds(this.pool, id);
    return toDoubt(result.rows[0], levelIds);
  }

  async updateStatus(id: string, status: DoubtStatus): Promise<Doubt | null> {
    const result = await this.pool.query<DoubtRow>(
      `UPDATE doubts
       SET status = $2,
           updated_at = now(),
           resolved_at = CASE WHEN $2 = 'resolved' THEN now() ELSE resolved_at END
       WHERE id = $1
       RETURNING *`,
      [id, status],
    );
    if (!result.rows[0]) return null;
    const levelIds = await this.fetchLevelIds(this.pool, id);
    return toDoubt(result.rows[0], levelIds);
  }

  async listByAuthor(authorUserId: string): Promise<Doubt[]> {
    const result = await this.pool.query<DoubtRow>(
      `SELECT * FROM doubts WHERE author_user_id = $1 ORDER BY created_at DESC`,
      [authorUserId],
    );
    const levelIdsByDoubt = await this.fetchLevelIdsForMany(this.pool, result.rows.map((r) => r.id));
    return result.rows.map((row) => toDoubt(row, levelIdsByDoubt.get(row.id) ?? []));
  }

  async listByLevels(expertiseLevelIds: string[], status: DoubtStatus, filters?: FeedFilters): Promise<Doubt[]> {
    if (expertiseLevelIds.length === 0) return [];

    // build the WHERE clause conditionally, always parameterized -- never string-interpolate
    // user-supplied values into the SQL text
    const conditions = [
      "status = $1",
      "EXISTS (SELECT 1 FROM doubt_expertise_levels del WHERE del.doubt_id = doubts.id AND del.expertise_level_id = ANY($2))",
    ];
    const params: unknown[] = [status, expertiseLevelIds];

    if (filters?.topic) {
      params.push(`%${filters.topic}%`);
      conditions.push(`(title ILIKE $${params.length} OR description ILIKE $${params.length})`);
    }

    if (filters?.createdAfter) {
      params.push(filters.createdAfter);
      conditions.push(`created_at >= $${params.length}`);
    }

    const result = await this.pool.query<DoubtRow>(
      `SELECT * FROM doubts
       WHERE ${conditions.join(" AND ")}
       ORDER BY created_at DESC`,
      params,
    );
    const levelIdsByDoubt = await this.fetchLevelIdsForMany(this.pool, result.rows.map((r) => r.id));
    return result.rows.map((row) => toDoubt(row, levelIdsByDoubt.get(row.id) ?? []));
  }
}
