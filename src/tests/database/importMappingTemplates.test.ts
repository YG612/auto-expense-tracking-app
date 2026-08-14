import type { DatabaseConnection } from '../../database';
import { createRepositories } from '../../database';
import { openMigratedTestDatabase } from './testDatabase';

describe('ImportMappingTemplateRepository', () => {
  let database: DatabaseConnection;

  beforeEach(async () => {
    database = await openMigratedTestDatabase();
  });

  afterEach(() => database.close());

  it('saves, updates, lists, and deletes validated local mappings', async () => {
    const repository = createRepositories(database).importMappingTemplates;
    await repository.save({
      id: 'mapping-1',
      name: '旧账本',
      mapping: { occurredAt: '日期', amount: '金额', merchant: '对象' },
      createdAt: '2026-08-14T00:00:00.000Z',
      updatedAt: '2026-08-14T00:00:00.000Z',
    });
    await repository.save({
      id: 'mapping-ignored-on-upsert',
      name: '旧账本',
      mapping: { occurredAt: '时间', amount: '数额' },
      createdAt: '2026-08-14T00:01:00.000Z',
      updatedAt: '2026-08-14T00:01:00.000Z',
    });

    await expect(repository.list()).resolves.toEqual([
      expect.objectContaining({
        id: 'mapping-1',
        name: '旧账本',
        mapping: { occurredAt: '时间', amount: '数额' },
      }),
    ]);
    await repository.delete('mapping-1');
    await expect(repository.list()).resolves.toEqual([]);
  });

  it('rejects mappings without the required columns', async () => {
    const repository = createRepositories(database).importMappingTemplates;
    await expect(
      repository.save({
        id: 'invalid',
        name: '无效',
        mapping: { merchant: '商户' },
        createdAt: '2026-08-14T00:00:00.000Z',
        updatedAt: '2026-08-14T00:00:00.000Z',
      }),
    ).rejects.toThrow('requires date and amount');
  });
});
