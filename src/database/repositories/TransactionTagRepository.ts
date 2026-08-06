import type { Tag } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { tagDefinition } from './entityDefinitions';

export class TransactionTagRepository {
  constructor(private readonly database: DatabaseConnection) {}

  async replaceTags(
    transactionId: string,
    tagIds: readonly string[],
  ): Promise<void> {
    const uniqueTagIds = [...new Set(tagIds)];

    await this.database.transaction(async transaction => {
      await transaction.execute(
        'DELETE FROM transaction_tags WHERE transaction_id = ?',
        [transactionId],
      );

      for (const tagId of uniqueTagIds) {
        await transaction.execute(
          `INSERT INTO transaction_tags (transaction_id, tag_id)
           VALUES (?, ?)`,
          [transactionId, tagId],
        );
      }
    });
  }

  async listForTransaction(transactionId: string): Promise<Tag[]> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `SELECT ${tagDefinition.columns.map(column => `t.${column}`).join(', ')}
         FROM tags t
         INNER JOIN transaction_tags tt ON tt.tag_id = t.id
         WHERE tt.transaction_id = ?
         ORDER BY t.name ASC`,
        [transactionId],
      );

      return result.rows.map(row => tagDefinition.fromRow(row));
    });
  }
}
