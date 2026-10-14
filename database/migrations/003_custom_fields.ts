import type { Connection } from 'mysql2/promise';
import {
  upgradeLegacyEventConfig,
  rosterField,
  type Answers,
  type Field,
} from '../../packages/contracts/src/index.js';
import { execute, rows } from '../../apps/api/src/db.js';
import { fieldValueDigest, rebuildFieldValues } from '../../apps/api/src/services/field-values.js';
export async function up(sql: Connection) {
  const events = await rows<{ id: string }>(sql, 'SELECT id FROM events ORDER BY id');
  for (const { id } of events) {
    await sql.beginTransaction();
    try {
      const [row] = await rows<{ config: unknown }>(
        sql,
        'SELECT config FROM events WHERE id=? FOR UPDATE',
        [id],
      );
      const raw =
        typeof row!.config === 'string'
          ? (JSON.parse(row!.config) as Record<string, unknown>)
          : (row!.config as Record<string, unknown>);
      const legacy = 'identity_type' in raw;
      const event = upgradeLegacyEventConfig(raw);
      const field = legacy ? event.fields[0] : rosterField(event);
      if (!field) {
        await sql.commit();
        continue;
      }
      const path = `$.${field.key}`;
      const missing = await rows(
        sql,
        "SELECT 1 FROM checkins WHERE event_id=? AND identity_value<>'' AND JSON_CONTAINS_PATH(answers,'one',?)=0 UNION ALL SELECT 1 FROM participants WHERE event_id=? AND JSON_CONTAINS_PATH(answers,'one',?)=0 LIMIT 1",
        [id, path, id, path],
      );
      if (!legacy && !missing.length) {
        await sql.commit();
        continue;
      }
      await execute(
        sql,
        "UPDATE checkins SET answers=JSON_SET(answers,?,identity_value) WHERE event_id=? AND identity_value<>'' AND JSON_CONTAINS_PATH(answers,'one',?)=0",
        [path, id, path],
      );
      await execute(
        sql,
        "UPDATE participants SET answers=JSON_SET(answers,?,identity_value) WHERE event_id=? AND JSON_CONTAINS_PATH(answers,'one',?)=0",
        [path, id, path],
      );
      const versions = await rows<{ version: number; fields: Field[] | string }>(
        sql,
        'SELECT version,fields FROM form_versions WHERE event_id=?',
        [id],
      );
      for (const version of versions) {
        const fields =
          typeof version.fields === 'string'
            ? (JSON.parse(version.fields) as Field[])
            : version.fields;
        await execute(sql, 'UPDATE form_versions SET fields=? WHERE event_id=? AND version=?', [
          JSON.stringify([
            ...(fields.some((item) => item.key === field.key) ? [] : [field]),
            ...fields.map((f) => ({
              ...f,
              allow_duplicates: f.allow_duplicates ?? true,
              ignore_case: f.ignore_case ?? false,
              roster_match: f.roster_match ?? false,
            })),
          ]),
          id,
          version.version,
        ]);
      }
      const participants = await rows<{ id: string; answers: Answers | string }>(
        sql,
        'SELECT id,answers FROM participants WHERE event_id=?',
        [id],
      );
      for (const p of participants) {
        const answers =
          typeof p.answers === 'string' ? (JSON.parse(p.answers) as Answers) : p.answers;
        await execute(sql, 'UPDATE participants SET identity_digest=? WHERE id=?', [
          fieldValueDigest(id, field, answers[field.key]!),
          p.id,
        ]);
      }
      await rebuildFieldValues(sql, { id, fields: event.fields });
      await execute(sql, 'UPDATE events SET config=?,policy_epoch=policy_epoch+1 WHERE id=?', [
        JSON.stringify(event),
        id,
      ]);
      await execute(sql, 'DELETE FROM import_jobs WHERE event_id=?', [id]);
      await sql.commit();
    } catch (error) {
      await sql.rollback();
      throw error;
    }
  }
}
