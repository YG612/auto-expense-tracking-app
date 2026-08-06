export const CATEGORY_TYPES = ['EXPENSE', 'INCOME'] as const;

export type CategoryType = (typeof CATEGORY_TYPES)[number];

export interface Category {
  id: string;
  type: CategoryType;
  parentId?: string;
  systemKey?: string;
  name: string;
  icon?: string;
  sortOrder: number;
  isSystem: boolean;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}
