import { getDatabase } from "@netlify/database";

const database = getDatabase();

export type DbRow = Record<string, unknown>;
export type DbResult<T extends DbRow = DbRow> = { rows: T[]; rowCount: number | null };
export type DbClient = {
  query<T extends DbRow = DbRow>(text: string, values?: unknown[]): Promise<DbResult<T>>;
  release?: () => void;
};

const pool = database.pool as unknown as DbClient & { connect(): Promise<DbClient> };

export async function query<T extends DbRow = DbRow>(text: string, values: unknown[] = []) {
  return pool.query<T>(text, values);
}

export async function transaction<T>(work: (client: DbClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await work(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release?.();
  }
}
