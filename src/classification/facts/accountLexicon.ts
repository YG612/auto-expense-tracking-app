import type { AccountType } from '../../domain/entities';

export const TRANSACTION_ACCOUNT_LEXICON_VERSION = '2026-08-22.1';

export type TransactionAccountDefinition = Readonly<{
  key: AccountType;
  aliases: readonly string[];
}>;

export const TRANSACTION_ACCOUNT_LEXICON: readonly TransactionAccountDefinition[] =
  [
    { key: 'WECHAT', aliases: ['微信支付', '微信'] },
    { key: 'ALIPAY', aliases: ['支付宝'] },
    { key: 'CREDIT_CARD', aliases: ['信用卡'] },
    { key: 'BANK_CARD', aliases: ['银行卡', '储蓄卡', '借记卡'] },
    { key: 'HUABEI', aliases: ['花呗'] },
    { key: 'CASH', aliases: ['现金'] },
  ];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

export function transactionAccountTokenSource(
  definitions: readonly TransactionAccountDefinition[] = TRANSACTION_ACCOUNT_LEXICON,
): string {
  const aliases = definitions
    .flatMap(definition => definition.aliases)
    .filter((value, index, all) => all.indexOf(value) === index)
    .sort(
      (left, right) => right.length - left.length || left.localeCompare(right),
    );
  if (aliases.length === 0) {
    throw new Error('账户模式至少需要一个账户别名。');
  }
  return `(?:${aliases.map(escapeRegExp).join('|')})`;
}

export function accountTypeForToken(token: string): AccountType | undefined {
  return TRANSACTION_ACCOUNT_LEXICON.find(definition =>
    definition.aliases.includes(token),
  )?.key;
}
