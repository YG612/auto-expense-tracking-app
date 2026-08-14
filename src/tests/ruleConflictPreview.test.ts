import type { UserRule } from '../domain/entities';
import { conflictingRulesFor } from '../features/personalization/RuleEditorScreen';

function rule(id: string, pattern: string, categoryId: string): UserRule {
  return {
    id,
    ruleType: 'KEYWORD',
    origin: 'USER_CREATED',
    pattern,
    transactionType: 'EXPENSE',
    categoryId,
    priority: 100,
    enabled: true,
    usageCount: 0,
    createdAt: '2026-08-14T00:00:00.000Z',
    updatedAt: '2026-08-14T00:00:00.000Z',
  };
}

describe('rule conflict preview', () => {
  it('finds enabled overlapping patterns with different outcomes', () => {
    const candidate = rule('candidate', '宠物粮', 'category-expense-pet');
    const conflict = rule('conflict', '宠物', 'category-expense-shopping');
    const sameTarget = rule('same', '宠物用品', 'category-expense-pet');
    const disabled = { ...rule('disabled', '宠物', 'other'), enabled: false };

    expect(
      conflictingRulesFor(candidate, [conflict, sameTarget, disabled]),
    ).toEqual([conflict]);
  });
});
