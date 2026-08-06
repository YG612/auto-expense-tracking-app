import type { Account } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { accountDefinition } from './entityDefinitions';

export class AccountRepository extends BaseRepository<Account> {
  constructor(database: DatabaseConnection) {
    super(database, accountDefinition);
  }

  async listVisible(): Promise<Account[]> {
    return this.select('is_hidden = 0');
  }

  async listVisibleByUsage(): Promise<Account[]> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `SELECT ${accountDefinition.columns.map(column => `account.${column}`).join(', ')},
                COUNT(transaction_entity.id) AS usage_count,
                MAX(transaction_entity.occurred_at) AS last_used_at
         FROM accounts account
         LEFT JOIN transactions transaction_entity
           ON transaction_entity.deleted_at IS NULL
          AND transaction_entity.account_id = account.id
         WHERE account.is_hidden = 0
         GROUP BY account.id
         ORDER BY usage_count DESC,
                  last_used_at DESC,
                  account.sort_order ASC,
                  account.name ASC`,
      );

      return result.rows.map(row => accountDefinition.fromRow(row));
    });
  }
}
