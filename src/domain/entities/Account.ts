export const ACCOUNT_TYPES = [
  'WECHAT',
  'ALIPAY',
  'CASH',
  'BANK_CARD',
  'CREDIT_CARD',
  'HUABEI',
  'OTHER',
] as const;

export type AccountType = (typeof ACCOUNT_TYPES)[number];

export interface Account {
  id: string;
  name: string;
  type: AccountType;
  currency: string;
  includeInNetWorth: boolean;
  openingBalanceMinor?: number;
  currentBalanceMinor?: number;
  icon?: string;
  sortOrder: number;
  isHidden: boolean;
  createdAt: string;
  updatedAt: string;
}
