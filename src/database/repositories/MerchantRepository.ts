import type { Merchant } from '../../domain/entities';
import type { DatabaseConnection } from '../types';
import { BaseRepository } from './BaseRepository';
import { merchantDefinition } from './entityDefinitions';

export interface MerchantDefaults {
  categoryId?: string;
  subcategoryId?: string;
}

function comparableMerchantName(value: string): string {
  return value.trim().toLowerCase();
}

export class MerchantRepository extends BaseRepository<Merchant> {
  constructor(database: DatabaseConnection) {
    super(database, merchantDefinition);
  }

  async findByNormalizedName(name: string): Promise<Merchant | undefined> {
    const rows = await this.select('normalized_name = ?', [name.trim()], '', 1);
    return rows[0];
  }

  async findByNameOrAlias(name: string): Promise<Merchant | undefined> {
    const comparableName = comparableMerchantName(name);

    if (comparableName.length === 0) {
      return undefined;
    }

    const exactMatch = await this.findByNormalizedName(name);

    if (exactMatch !== undefined) {
      return exactMatch;
    }

    const merchants = await this.listAll();
    return merchants.find(merchant =>
      [merchant.canonicalName, merchant.normalizedName, ...merchant.aliases]
        .map(comparableMerchantName)
        .includes(comparableName),
    );
  }

  async updateDefaults(
    id: string,
    defaults: MerchantDefaults,
    updatedAt: string,
  ): Promise<boolean> {
    return this.database.transaction(async transaction => {
      const result = await transaction.execute(
        `UPDATE merchants
         SET default_category_id = ?, default_subcategory_id = ?, updated_at = ?
         WHERE id = ?`,
        [
          defaults.categoryId ?? null,
          defaults.subcategoryId ?? null,
          updatedAt,
          id,
        ],
      );

      return result.rowsAffected === 1;
    });
  }

  async remove(id: string): Promise<boolean> {
    return this.database.transaction(transaction =>
      this.deleteById(id, transaction),
    );
  }
}
