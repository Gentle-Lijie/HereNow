import type { Connection, RowDataPacket } from 'mysql2/promise';
// Preserve old activities; English labels must be supplied on subsequent edits or publication.
export async function up(connection: Connection) {
  const [events] = await connection.query<RowDataPacket[]>(
    'SELECT CAST(id AS CHAR) AS id FROM events ORDER BY events.id',
  );
  for (const event of events) {
    await connection.beginTransaction();
    try {
      const [rows] = await connection.query<RowDataPacket[]>(
        'SELECT config FROM events WHERE id=? FOR UPDATE',
        [String(event.id)],
      );
      if (!rows[0]) {
        await connection.commit();
        continue;
      }
      const raw: unknown =
        typeof rows[0].config === 'string' ? JSON.parse(rows[0].config) : rows[0].config;
      if (!raw || typeof raw !== 'object' || Array.isArray(raw))
        throw new Error('Invalid stored event configuration');
      const config = raw as Record<string, unknown>;
      if (!Array.isArray(config.fields)) throw new Error('Invalid stored event fields');
      const fields = config.fields.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || Array.isArray(entry))
          throw new Error('Invalid stored field');
        const field = entry as Record<string, unknown>;
        return { ...field, label_en: typeof field.label_en === 'string' ? field.label_en : '' };
      });
      await connection.query(
        "UPDATE events SET config=JSON_SET(config,'$.fields',CAST(? AS JSON)) WHERE id=?",
        [JSON.stringify(fields), String(event.id)],
      );
      await connection.commit();
    } catch (error) {
      await connection.rollback();
      throw error;
    }
  }
}
