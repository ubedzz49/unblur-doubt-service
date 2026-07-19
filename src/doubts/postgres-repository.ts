import { Pool } from "pg";
import { CreateDoubtInput, Doubt, DoubtRepository, DoubtStatus } from "./repository.js";

interface DoubtRow {
  id: string;
  author_user_id: string;
  title: string;
  description: string;
  expertise_level_id: string;
  status: DoubtStatus;
  created_at: string;
  updated_at: string;
  resolved_at: string | null;
}

function toDoubt(row: DoubtRow): Doubt {
  return {
    id: row.id,
    authorUserId: row.author_user_id,
    title: row.title,
    description: row.description,
    expertiseLevelId: row.expertise_level_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    resolvedAt: row.resolved_at,
  };
}

export class PostgresDoubtRepository implements DoubtRepository {
  constructor(private pool: Pool) {}

  async create(input: CreateDoubtInput): Promise<Doubt> {
    const result = await this.pool.query<DoubtRow>(
      `INSERT INTO doubts (author_user_id, title, description, expertise_level_id)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [input.authorUserId, input.title, input.description, input.expertiseLevelId],
    );
    return toDoubt(result.rows[0]);
  }

  async getById(id: string): Promise<Doubt | null> {
    const result = await this.pool.query<DoubtRow>(`SELECT * FROM doubts WHERE id = $1`, [id]);
    return result.rows[0] ? toDoubt(result.rows[0]) : null;
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
    return result.rows[0] ? toDoubt(result.rows[0]) : null;
  }

  async listByAuthor(authorUserId: string): Promise<Doubt[]> {
    const result = await this.pool.query<DoubtRow>(
      `SELECT * FROM doubts WHERE author_user_id = $1 ORDER BY created_at DESC`,
      [authorUserId],
    );
    return result.rows.map(toDoubt);
  }

  async listOpenByLevels(expertiseLevelIds: string[]): Promise<Doubt[]> {
    if (expertiseLevelIds.length === 0) return [];
    const result = await this.pool.query<DoubtRow>(
      `SELECT * FROM doubts
       WHERE status = 'open' AND expertise_level_id = ANY($1)
       ORDER BY created_at DESC`,
      [expertiseLevelIds],
    );
    return result.rows.map(toDoubt);
  }
}
