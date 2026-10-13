import mysql, {
  type RowDataPacket,
  type ResultSetHeader,
  type PoolConnection,
} from 'mysql2/promise';
import { config } from './config.js';
export const db = mysql.createPool({
  host: config.DB_HOST,
  port: config.DB_PORT,
  user: config.DB_USER,
  password: config.DB_PASSWORD,
  database: config.DB_NAME,
  connectionLimit: 20,
  timezone: 'Z',
  supportBigNumbers: true,
  bigNumberStrings: true,
  decimalNumbers: true,
  charset: 'utf8mb4',
});
export type Sql = typeof db | PoolConnection;
export async function rows<T>(sql: Sql, query: string, values: unknown[] = []): Promise<T[]> {
  const [r] = await sql.query<RowDataPacket[]>(query, values);
  return r as T[];
}
export async function execute(sql: Sql, query: string, values: unknown[] = []) {
  const [r] = await sql.query<ResultSetHeader>(query, values);
  return r;
}
export async function transaction<T>(fn: (c: PoolConnection) => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const c = await db.getConnection();
    try {
      await c.query("SET time_zone = '+00:00'");
      await c.query('SET TRANSACTION ISOLATION LEVEL READ COMMITTED');
      await c.beginTransaction();
      const result = await fn(c);
      await c.commit();
      return result;
    } catch (e) {
      await c.rollback();
      const code = (e as { code?: string }).code;
      if (attempt < 2 && ['ER_LOCK_DEADLOCK', 'ER_LOCK_WAIT_TIMEOUT'].includes(code ?? '')) {
        await new Promise((r) => setTimeout(r, 30 * (attempt + 1)));
        continue;
      }
      throw e;
    } finally {
      c.release();
    }
  }
}
