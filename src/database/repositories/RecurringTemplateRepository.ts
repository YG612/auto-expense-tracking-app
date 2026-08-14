import type { RecurringTemplate, Transaction } from '../../domain/entities';
import type { DatabaseConnection, SqlExecutor, SqlRow } from '../types';
import {
  optionalString,
  requiredBoolean,
  requiredNumber,
  requiredString,
} from './mappingHelpers';
import {
  canonicalUtcTimestamp,
  createValidatedTransactionWithTags,
} from './transactionWriteIntegrity';

type TemplateRow = SqlRow & {
  id: string;
  name: string;
  type: string;
  amount_minor: number;
  currency: string;
  category_id: string;
  account_id: string;
  note: string | null;
  cadence: string;
  next_occurrence_at: string;
  monthly_anchor_day: number | null;
  monthly_anchor_is_end_of_month: number | null;
  enabled: number;
  last_generated_at: string | null;
  created_at: string;
  updated_at: string;
};

function fromRow(row: TemplateRow): RecurringTemplate {
  return {
    id: requiredString(row, 'id'),
    name: requiredString(row, 'name'),
    type: requiredString(row, 'type') as RecurringTemplate['type'],
    amountMinor: requiredNumber(row, 'amount_minor'),
    currency: requiredString(row, 'currency') as 'CNY',
    categoryId: requiredString(row, 'category_id'),
    accountId: requiredString(row, 'account_id'),
    note: optionalString(row, 'note'),
    cadence: requiredString(row, 'cadence') as RecurringTemplate['cadence'],
    nextOccurrenceAt: requiredString(row, 'next_occurrence_at'),
    monthlyAnchorDay:
      row.monthly_anchor_day === null
        ? undefined
        : requiredNumber(row, 'monthly_anchor_day'),
    monthlyAnchorIsEndOfMonth:
      row.monthly_anchor_is_end_of_month === null
        ? undefined
        : requiredBoolean(row, 'monthly_anchor_is_end_of_month'),
    enabled: requiredBoolean(row, 'enabled'),
    lastGeneratedAt: optionalString(row, 'last_generated_at'),
    createdAt: requiredString(row, 'created_at'),
    updatedAt: requiredString(row, 'updated_at'),
  };
}

function nextOccurrence(
  iso: string,
  cadence: RecurringTemplate['cadence'],
  monthlyAnchorDay?: number,
  monthlyAnchorIsEndOfMonth?: boolean,
): string {
  const current = new Date(iso);
  if (cadence === 'WEEKLY') {
    current.setUTCDate(current.getUTCDate() + 7);
    return current.toISOString();
  }
  const day = monthlyAnchorDay ?? current.getUTCDate();
  const year = current.getUTCFullYear();
  const targetMonth = current.getUTCMonth() + 1;
  const lastDay = new Date(Date.UTC(year, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      targetMonth,
      monthlyAnchorIsEndOfMonth ? lastDay : Math.min(day, lastDay),
      current.getUTCHours(),
      current.getUTCMinutes(),
      current.getUTCSeconds(),
      current.getUTCMilliseconds(),
    ),
  ).toISOString();
}

function monthlyAnchorFor(
  template: RecurringTemplate,
  nextOccurrenceAt: string,
): { day?: number; isEndOfMonth?: boolean } {
  if (template.cadence !== 'MONTHLY') return {};
  const date = new Date(nextOccurrenceAt);
  const day = template.monthlyAnchorDay ?? date.getUTCDate();
  if (!Number.isInteger(day) || day < 1 || day > 31) {
    throw new Error('月度周期锚点无效。');
  }
  const lastDay = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return {
    day,
    isEndOfMonth: template.monthlyAnchorIsEndOfMonth ?? day === lastDay,
  };
}

async function categoryAssignment(
  categoryId: string,
  transactionType: RecurringTemplate['type'],
  executor: SqlExecutor,
): Promise<{ categoryId: string; subcategoryId?: string }> {
  const result = await executor.execute<{ parent_id: string | null }>(
    `SELECT child.parent_id
     FROM categories child
     LEFT JOIN categories parent ON parent.id = child.parent_id
     WHERE child.id = ? AND child.type = ? AND child.is_hidden = 0
       AND (child.parent_id IS NULL OR parent.is_hidden = 0)`,
    [categoryId, transactionType],
  );
  const row = result.rows[0];
  if (row === undefined) throw new Error('Recurring category is missing.');
  return row.parent_id === null
    ? { categoryId }
    : { categoryId: row.parent_id, subcategoryId: categoryId };
}

export class RecurringTemplateRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async list(): Promise<RecurringTemplate[]> {
    const result = await this.database.execute<TemplateRow>(
      'SELECT * FROM recurring_templates ORDER BY enabled DESC, next_occurrence_at ASC',
    );
    return result.rows.map(fromRow);
  }

  async create(template: RecurringTemplate): Promise<void> {
    const id = template.id.trim();
    if (id.length === 0 || id.length > 64) throw new Error('周期标识无效。');
    const name = template.name.trim();
    if (name.length === 0 || name.length > 120)
      throw new Error('周期名称无效。');
    if (
      !Number.isSafeInteger(template.amountMinor) ||
      template.amountMinor <= 0
    ) {
      throw new Error('周期金额无效。');
    }
    if (!['EXPENSE', 'INCOME'].includes(template.type))
      throw new Error('周期类型无效。');
    if (!['WEEKLY', 'MONTHLY'].includes(template.cadence))
      throw new Error('周期间隔无效。');
    const next = canonicalUtcTimestamp(
      template.nextOccurrenceAt,
      'nextOccurrenceAt',
    );
    const created = canonicalUtcTimestamp(template.createdAt, 'createdAt');
    const updated = canonicalUtcTimestamp(template.updatedAt, 'updatedAt');
    const monthlyAnchor = monthlyAnchorFor(template, next);
    await this.database.transaction(async executor => {
      await categoryAssignment(template.categoryId, template.type, executor);
      const account = await executor.execute(
        'SELECT id FROM accounts WHERE id = ? AND is_hidden = 0',
        [template.accountId],
      );
      if (account.rows[0] === undefined) throw new Error('周期账户不可用。');
      await executor.execute(
        `INSERT INTO recurring_templates (
          id, name, type, amount_minor, currency, category_id, account_id,
          note, cadence, next_occurrence_at, monthly_anchor_day,
          monthly_anchor_is_end_of_month, enabled,
          last_generated_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'CNY', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id,
          name,
          template.type,
          template.amountMinor,
          template.categoryId,
          template.accountId,
          template.note?.trim() || null,
          template.cadence,
          next,
          monthlyAnchor.day ?? null,
          monthlyAnchor.isEndOfMonth === undefined
            ? null
            : monthlyAnchor.isEndOfMonth
              ? 1
              : 0,
          template.enabled ? 1 : 0,
          template.lastGeneratedAt ?? null,
          created,
          updated,
        ],
      );
    });
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    updatedAt: string,
  ): Promise<void> {
    const result = await this.database.execute(
      'UPDATE recurring_templates SET enabled = ?, updated_at = ? WHERE id = ?',
      [enabled ? 1 : 0, canonicalUtcTimestamp(updatedAt, 'updatedAt'), id],
    );
    if (result.rowsAffected !== 1)
      throw new Error('Recurring template not found.');
  }

  async delete(id: string): Promise<void> {
    await this.database.transaction(async executor => {
      const result = await executor.execute(
        'DELETE FROM recurring_templates WHERE id = ?',
        [id],
      );
      if (result.rowsAffected !== 1)
        throw new Error('Recurring template not found.');
    });
  }

  async materializeDue(now: string): Promise<number> {
    const canonicalNow = canonicalUtcTimestamp(now, 'now');
    return this.database.transaction(async executor => {
      const result = await executor.execute<TemplateRow>(
        `SELECT * FROM recurring_templates
         WHERE enabled = 1 AND next_occurrence_at <= ?
         ORDER BY next_occurrence_at ASC`,
        [canonicalNow],
      );
      let generated = 0;
      for (const row of result.rows) {
        const template = fromRow(row);
        const assignment = await categoryAssignment(
          template.categoryId,
          template.type,
          executor,
        );
        const account = await executor.execute(
          'SELECT id FROM accounts WHERE id = ? AND is_hidden = 0',
          [template.accountId],
        );
        if (account.rows[0] === undefined) {
          throw new Error('周期账户不可用。');
        }
        let occurrence = template.nextOccurrenceAt;
        let perTemplate = 0;
        while (occurrence <= canonicalNow && perTemplate < 36) {
          const sourceReferenceId = `recurring:${template.id}:${occurrence}`;
          const existing = await executor.execute(
            'SELECT id FROM transactions WHERE source_reference_id = ?',
            [sourceReferenceId],
          );
          if (existing.rows[0] === undefined) {
            const transaction: Transaction = {
              id: sourceReferenceId,
              revision: 1,
              type: template.type,
              amountMinor: template.amountMinor,
              currency: template.currency,
              occurredAt: occurrence,
              ...assignment,
              accountId: template.accountId,
              note: template.note ?? template.name,
              source: 'MANUAL',
              sourceReferenceId,
              requiresReview: false,
              reviewReasonCodes: [],
              confirmationStatus: 'PENDING',
              duplicateStatus: 'NONE',
              createdAt: canonicalNow,
              updatedAt: canonicalNow,
              syncStatus: 'LOCAL_ONLY',
            };
            await createValidatedTransactionWithTags(executor, transaction, []);
            generated += 1;
          }
          occurrence = nextOccurrence(
            occurrence,
            template.cadence,
            template.monthlyAnchorDay,
            template.monthlyAnchorIsEndOfMonth,
          );
          perTemplate += 1;
        }
        await executor.execute(
          `UPDATE recurring_templates
           SET next_occurrence_at = ?, last_generated_at = ?, updated_at = ?
           WHERE id = ?`,
          [occurrence, canonicalNow, canonicalNow, template.id],
        );
      }
      return generated;
    });
  }
}
