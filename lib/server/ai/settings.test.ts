import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import type { AuditActor } from '@/lib/server/audit';
import { TEST_DATABASE_URL } from '@/test/helpers/db';
import { loadAiSettings, saveAiSettings } from './settings';

vi.mock('next/cache', () => ({ cacheLife: () => {}, cacheTag: () => {} }));

const ACTOR: AuditActor = { id: 'staff-lan', email: 'lan@furama.test', name: 'Lan' };
let pool: Pool;

describe.skipIf(!TEST_DATABASE_URL)('AI settings (database)', () => {
  beforeAll(() => {
    pool = new Pool({ connectionString: TEST_DATABASE_URL });
  });
  afterAll(async () => {
    await pool.query(`UPDATE ai_settings SET data = '{}'::jsonb, updated_by = NULL`);
    await pool.query(`DELETE FROM staff_user WHERE id = 'staff-lan'`);
    await pool.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE audit_log');
    // Other files TRUNCATE staff_user ... CASCADE, which empties ai_settings (its updated_by points there); migration 011 seeds the row.
    await pool.query(`INSERT INTO ai_settings (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`);
    await pool.query(`UPDATE ai_settings SET data = '{}'::jsonb, updated_at = now(), updated_by = NULL`);
    await pool.query(`INSERT INTO staff_user (id, name, email, email_verified, role) VALUES ('staff-lan', 'Lan', 'lan@furama.test', true, 'editor') ON CONFLICT (id) DO NOTHING`);
  });

  it('reads {} as the defaults, with a microsecond token', async () => {
    const { settings, token } = await loadAiSettings(pool);
    expect(settings.budgetUsd).toBe(20);
    expect(settings.features.seo.model).toBe('gemini-3.8-flash');
    expect(token).toMatch(/^\d{15,}$/);
  });

  it('saves with the right token, and audits before and after', async () => {
    const { settings, token } = await loadAiSettings(pool);
    const next = { ...settings, budgetUsd: 50 };
    expect(await saveAiSettings(pool, ACTOR, { settings: next, token })).toEqual({ ok: true, data: null });
    expect((await loadAiSettings(pool)).settings.budgetUsd).toBe(50);
    const { rows } = await pool.query(`SELECT entity_type, before, after FROM audit_log`);
    expect(rows).toHaveLength(1);
    expect(rows[0].entity_type).toBe('ai_settings');
    expect(rows[0].before.budgetUsd).toBe(20);
    expect(rows[0].after.budgetUsd).toBe(50);
  });

  it('answers a stale token with a conflict naming who saved', async () => {
    const { settings, token } = await loadAiSettings(pool);
    await saveAiSettings(pool, ACTOR, { settings, token });
    const res = await saveAiSettings(pool, ACTOR, { settings, token });
    expect(res).toMatchObject({ ok: false, code: 'conflict', params: { by: expect.any(String), at: expect.any(String) } });
  });

  it('throws a ZodError for a model outside the catalogue', async () => {
    const { token } = await loadAiSettings(pool);
    await expect(saveAiSettings(pool, ACTOR, { settings: { features: { seo: { model: 'gpt' } } } as never, token })).rejects.toBeInstanceOf(ZodError);
  });
});
