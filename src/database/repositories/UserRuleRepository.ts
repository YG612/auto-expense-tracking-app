import type { RuleOrigin, RuleType, UserRule } from '../../domain/entities';
import type { DatabaseConnection, SqlExecutor, SqlValue } from '../types';
import { BaseRepository } from './BaseRepository';
import { userRuleDefinition } from './entityDefinitions';

export interface UserRuleListOptions {
  enabled?: boolean;
  ruleTypes?: readonly RuleType[];
  origins?: readonly RuleOrigin[];
}

export interface LearnedRuleSuppression {
  ruleType: 'MERCHANT';
  pattern: string;
  suppressedAt: string;
}

function assertIntegerPriority(priority: number): void {
  if (!Number.isInteger(priority)) {
    throw new Error('Rule priority must be an integer.');
  }
}

export class UserRuleRepository extends BaseRepository<UserRule> {
  constructor(database: DatabaseConnection) {
    super(database, userRuleDefinition);
  }

  override async update(rule: UserRule): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const existing = (
        await this.select('id = ?', [rule.id], '', 1, transaction)
      )[0];

      if (existing === undefined) {
        return false;
      }

      await this.suppressIfLearnedMerchant(
        existing,
        rule.updatedAt,
        transaction,
      );
      return this.updateEntity(
        { ...rule, origin: 'USER_CREATED' },
        transaction,
      );
    });
  }

  async list(options: UserRuleListOptions = {}): Promise<UserRule[]> {
    const clauses: string[] = [];
    const params: SqlValue[] = [];

    if (options.enabled !== undefined) {
      clauses.push('enabled = ?');
      params.push(options.enabled ? 1 : 0);
    }

    if (options.ruleTypes !== undefined) {
      if (options.ruleTypes.length === 0) {
        return [];
      }

      clauses.push(
        `rule_type IN (${options.ruleTypes.map(() => '?').join(', ')})`,
      );
      params.push(...options.ruleTypes);
    }

    if (options.origins !== undefined) {
      if (options.origins.length === 0) {
        return [];
      }

      clauses.push(`origin IN (${options.origins.map(() => '?').join(', ')})`);
      params.push(...options.origins);
    }

    return this.select(
      clauses.length === 0 ? undefined : clauses.join(' AND '),
      params,
    );
  }

  async listEnabled(ruleTypes?: readonly RuleType[]): Promise<UserRule[]> {
    return this.list({ enabled: true, ruleTypes });
  }

  async findByPattern(
    ruleType: RuleType,
    pattern: string,
  ): Promise<UserRule[]> {
    return this.select('rule_type = ? AND pattern = ?', [ruleType, pattern]);
  }

  async setEnabled(
    id: string,
    enabled: boolean,
    updatedAt: string,
  ): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE user_rules
         SET enabled = ?, updated_at = ?
         WHERE id = ?`,
        [enabled ? 1 : 0, updatedAt, id],
      );

      return result.rowsAffected === 1;
    });
  }

  async setPriority(
    id: string,
    priority: number,
    updatedAt: string,
  ): Promise<boolean> {
    assertIntegerPriority(priority);

    return this.database.transaction(async transaction => {
      const existing = (
        await this.select('id = ?', [id], '', 1, transaction)
      )[0];

      if (existing === undefined) {
        return false;
      }

      await this.suppressIfLearnedMerchant(existing, updatedAt, transaction);
      const result = await transaction.execute(
        `UPDATE user_rules
         SET priority = ?, origin = 'USER_CREATED', updated_at = ?
         WHERE id = ?`,
        [priority, updatedAt, id],
      );

      return result.rowsAffected === 1;
    });
  }

  async recordUsage(id: string, usedAt: string): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE user_rules
         SET usage_count = usage_count + 1,
             last_used_at = ?,
             updated_at = ?
         WHERE id = ?`,
        [usedAt, usedAt, id],
      );

      return result.rowsAffected === 1;
    });
  }

  async listLearnedSuppressions(): Promise<LearnedRuleSuppression[]> {
    const result = await this.database.execute<{
      rule_type: 'MERCHANT';
      pattern: string;
      suppressed_at: string;
    }>(
      `SELECT rule_type, pattern, suppressed_at
       FROM learned_rule_suppressions
       ORDER BY suppressed_at DESC`,
    );

    return result.rows.map(row => ({
      ruleType: row.rule_type,
      pattern: row.pattern,
      suppressedAt: row.suppressed_at,
    }));
  }

  async isLearnedMerchantSuppressed(pattern: string): Promise<boolean> {
    const result = await this.database.execute<{ count: number }>(
      `SELECT COUNT(*) AS count
       FROM learned_rule_suppressions
       WHERE rule_type = 'MERCHANT' AND pattern = ? COLLATE NOCASE`,
      [pattern],
    );

    return (result.rows[0]?.count ?? 0) > 0;
  }

  async clearLearnedMerchantSuppression(pattern: string): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `DELETE FROM learned_rule_suppressions
         WHERE rule_type = 'MERCHANT' AND pattern = ? COLLATE NOCASE`,
        [pattern],
      );

      return result.rowsAffected === 1;
    });
  }

  async remove(
    id: string,
    suppressedAt: string = new Date().toISOString(),
  ): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const rows = await this.select('id = ?', [id], '', 1, transaction);
      const rule = rows[0];

      if (rule === undefined) {
        return false;
      }

      if (rule.origin === 'LEARNED_MERCHANT' && rule.ruleType === 'MERCHANT') {
        await transaction.execute(
          `INSERT INTO learned_rule_suppressions (
             rule_type, pattern, suppressed_at
           ) VALUES ('MERCHANT', ?, ?)
           ON CONFLICT(rule_type, pattern)
           DO UPDATE SET suppressed_at = excluded.suppressed_at`,
          [rule.pattern, suppressedAt],
        );
      }

      return this.deleteById(id, transaction);
    });
  }

  private async suppressIfLearnedMerchant(
    rule: UserRule,
    suppressedAt: string,
    executor: SqlExecutor,
  ): Promise<void> {
    if (rule.origin !== 'LEARNED_MERCHANT' || rule.ruleType !== 'MERCHANT') {
      return;
    }

    await executor.execute(
      `INSERT INTO learned_rule_suppressions (
         rule_type, pattern, suppressed_at
       ) VALUES ('MERCHANT', ?, ?)
       ON CONFLICT(rule_type, pattern)
       DO UPDATE SET suppressed_at = excluded.suppressed_at`,
      [rule.pattern, suppressedAt],
    );
  }
}
