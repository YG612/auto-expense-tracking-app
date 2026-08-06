import type { Category, CategoryType } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { categoryDefinition } from './entityDefinitions';

export class CategoryRepository extends BaseRepository<Category> {
  constructor(database: DatabaseConnection) {
    super(database, categoryDefinition);
  }

  async listVisible(type?: CategoryType): Promise<Category[]> {
    if (type === undefined) {
      return this.select('is_hidden = 0');
    }

    return this.select('is_hidden = 0 AND type = ?', [type]);
  }

  async listVisibleByUsage(type: CategoryType): Promise<Category[]> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `SELECT ${categoryDefinition.columns.map(column => `category.${column}`).join(', ')},
                COUNT(transaction_entity.id) AS usage_count,
                MAX(transaction_entity.occurred_at) AS last_used_at
         FROM categories category
         LEFT JOIN categories parent_category
           ON parent_category.id = category.parent_id
         LEFT JOIN transactions transaction_entity
           ON transaction_entity.deleted_at IS NULL
          AND (
            transaction_entity.subcategory_id = category.id OR
            (
              transaction_entity.subcategory_id IS NULL AND
              transaction_entity.category_id = category.id
            )
          )
         WHERE category.is_hidden = 0 AND category.type = ?
         GROUP BY category.id
         ORDER BY usage_count DESC,
                  last_used_at DESC,
                  COALESCE(parent_category.sort_order, category.sort_order) ASC,
                  CASE WHEN category.parent_id IS NULL THEN -1 ELSE category.sort_order END ASC,
                  category.name ASC`,
        [type],
      );

      return result.rows.map(row => categoryDefinition.fromRow(row));
    });
  }
}
