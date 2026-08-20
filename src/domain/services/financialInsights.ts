import type { BudgetProgress } from './analytics';

export type InsightTransaction = {
  id: string;
  type: string;
  amountMinor: number;
  occurredAt: string;
  categoryId?: string;
  categoryName?: string;
  merchantRawName?: string;
  merchantName?: string;
};

export type FinancialInsightKind =
  | 'BUDGET_DEVIATION'
  | 'CATEGORY_RISING'
  | 'LARGE_EXPENSE'
  | 'SUBSCRIPTION_CANDIDATE'
  | 'SAFE_TO_SPEND';

export type FinancialInsight = {
  id: string;
  kind: FinancialInsightKind;
  title: string;
  detail: string;
  calculation: string;
  calculationContainsAmount: boolean;
  amountMinor?: number;
  categoryId?: string;
  transactionIds: readonly string[];
};

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 0) return 0;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[middle - 1]! + sorted[middle]!) / 2)
    : sorted[middle]!;
}

function monthKey(value: string): string {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function normalizedMerchant(transaction: InsightTransaction): string {
  return (transaction.merchantRawName ?? transaction.merchantName ?? '')
    .normalize('NFKC')
    .toLocaleLowerCase('zh-CN')
    .replaceAll(/[\s\p{P}\p{S}]/gu, '');
}

export function buildFinancialInsights(input: {
  transactions: readonly InsightTransaction[];
  budget?: BudgetProgress;
  selectedMonth: Date;
  now?: Date;
}): FinancialInsight[] {
  const now = input.now ?? new Date();
  const currentKey = `${input.selectedMonth.getFullYear()}-${String(
    input.selectedMonth.getMonth() + 1,
  ).padStart(2, '0')}`;
  const expenses = input.transactions.filter(
    transaction => transaction.type === 'EXPENSE',
  );
  const currentExpenses = expenses.filter(
    transaction => monthKey(transaction.occurredAt) === currentKey,
  );
  const insights: FinancialInsight[] = [];

  if (input.budget !== undefined && input.budget.progress >= 0.8) {
    insights.push({
      id: 'budget-deviation',
      kind: 'BUDGET_DEVIATION',
      title: input.budget.isOver ? '本月预算已超出' : '本月预算接近上限',
      detail: input.budget.isOver
        ? '可以从高占比分类开始核对，不代表未来一定继续超支。'
        : '当前已使用至少 80%，建议结合剩余天数安排支出。',
      calculation: `已确认支出 ÷ 月度预算 = ${Math.round(
        input.budget.progress * 100,
      )}%`,
      calculationContainsAmount: false,
      amountMinor: Math.abs(input.budget.remainingMinor),
      transactionIds: currentExpenses.map(transaction => transaction.id),
    });
  }

  if (
    input.budget !== undefined &&
    !input.budget.isOver &&
    input.selectedMonth.getFullYear() === now.getFullYear() &&
    input.selectedMonth.getMonth() === now.getMonth()
  ) {
    const daysInMonth = new Date(
      now.getFullYear(),
      now.getMonth() + 1,
      0,
    ).getDate();
    const remainingDays = Math.max(1, daysInMonth - now.getDate() + 1);
    const daily = Math.floor(input.budget.remainingMinor / remainingDays);
    insights.push({
      id: 'safe-to-spend',
      kind: 'SAFE_TO_SPEND',
      title: '按预算折算的每日可用额度',
      detail: '这是剩余预算的平均分配，不是对未来消费的预测。',
      calculation: `剩余预算 ÷ 剩余 ${remainingDays} 天`,
      calculationContainsAmount: false,
      amountMinor: daily,
      transactionIds: currentExpenses.map(transaction => transaction.id),
    });
  }

  const byCategoryMonth = new Map<string, Map<string, InsightTransaction[]>>();
  for (const transaction of expenses) {
    const category = transaction.categoryId ?? transaction.categoryName;
    if (category === undefined) continue;
    const months = byCategoryMonth.get(category) ?? new Map();
    const key = monthKey(transaction.occurredAt);
    months.set(key, [...(months.get(key) ?? []), transaction]);
    byCategoryMonth.set(category, months);
  }
  const previousKeys = [2, 1, 0].map(offset => {
    const date = new Date(
      input.selectedMonth.getFullYear(),
      input.selectedMonth.getMonth() - offset,
      1,
    );
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  });
  const rising = [...byCategoryMonth.entries()]
    .map(([category, months]) => {
      const groups = previousKeys.map(key => months.get(key) ?? []);
      const totals = groups.map(group =>
        group.reduce((sum, transaction) => sum + transaction.amountMinor, 0),
      );
      return { category, groups, totals };
    })
    .filter(
      item =>
        item.totals[0]! > 0 &&
        item.totals[0]! < item.totals[1]! &&
        item.totals[1]! < item.totals[2]!,
    )
    .sort((left, right) => right.totals[2]! - left.totals[2]!)[0];
  if (rising !== undefined) {
    const current = rising.groups[2]!;
    insights.push({
      id: `category-rising-${rising.category}`,
      kind: 'CATEGORY_RISING',
      title: `${current[0]?.categoryName ?? '某分类'}连续三个月上涨`,
      detail: '仅描述已确认账目的历史变化，不推断下个月走势。',
      calculation: rising.totals
        .map(value => `${Math.round(value / 100)}元`)
        .join(' → '),
      calculationContainsAmount: true,
      amountMinor: rising.totals[2],
      categoryId: current[0]?.categoryId,
      transactionIds: rising.groups.flat().map(transaction => transaction.id),
    });
  }

  const currentAmounts = currentExpenses.map(
    transaction => transaction.amountMinor,
  );
  const typical = median(currentAmounts);
  const unusualThreshold = Math.max(100_000, typical * 4);
  const unusual = currentExpenses
    .filter(transaction => transaction.amountMinor >= unusualThreshold)
    .sort((left, right) => right.amountMinor - left.amountMinor)[0];
  if (unusual !== undefined && currentExpenses.length >= 4) {
    insights.push({
      id: `large-expense-${unusual.id}`,
      kind: 'LARGE_EXPENSE',
      title: '发现一笔显著高于本月常见水平的支出',
      detail:
        unusual.merchantRawName ??
        unusual.merchantName ??
        '可打开流水核对详情。',
      calculation: `该笔金额至少为本月支出中位数的 4 倍，且不低于 1000 元`,
      calculationContainsAmount: false,
      amountMinor: unusual.amountMinor,
      categoryId: unusual.categoryId,
      transactionIds: [unusual.id],
    });
  }

  const subscriptionGroups = new Map<string, InsightTransaction[]>();
  for (const transaction of expenses) {
    const merchant = normalizedMerchant(transaction);
    if (merchant.length === 0) continue;
    const key = `${merchant}|${transaction.amountMinor}`;
    subscriptionGroups.set(key, [
      ...(subscriptionGroups.get(key) ?? []),
      transaction,
    ]);
  }
  const subscription = [...subscriptionGroups.values()].find(group => {
    if (group.length < 3) return false;
    const times = group
      .map(transaction => Date.parse(transaction.occurredAt))
      .sort((left, right) => left - right);
    const intervals = times
      .slice(1)
      .map((time, index) => (time - times[index]!) / (24 * 60 * 60 * 1000));
    return intervals.slice(-2).every(days => days >= 25 && days <= 35);
  });
  if (subscription !== undefined) {
    insights.push({
      id: `subscription-${subscription[0]!.id}`,
      kind: 'SUBSCRIPTION_CANDIDATE',
      title: '可能存在按月重复支出',
      detail:
        subscription[0]!.merchantRawName ??
        subscription[0]!.merchantName ??
        '同商户',
      calculation: '同一商户、相同金额至少出现 3 次，最近间隔为 25–35 天',
      calculationContainsAmount: false,
      amountMinor: subscription[0]!.amountMinor,
      categoryId: subscription[0]!.categoryId,
      transactionIds: subscription.map(transaction => transaction.id),
    });
  }

  return insights.slice(0, 5);
}
