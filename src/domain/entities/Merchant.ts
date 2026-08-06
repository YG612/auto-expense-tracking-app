export interface Merchant {
  id: string;
  canonicalName: string;
  normalizedName: string;
  aliases: string[];
  defaultCategoryId?: string;
  defaultSubcategoryId?: string;
  createdAt: string;
  updatedAt: string;
}
