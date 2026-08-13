import {
  collectSemanticCategoryProposals,
  resolveSemanticCategory,
} from '../classification/semantic';

describe('semantic category resolver', () => {
  const resolveExpense = (text: string) =>
    resolveSemanticCategory(text, { transactionType: 'EXPENSE' });

  it.each([
    ['我今天在网吧消费了10元', 'expense.entertainment.games'],
    ['网咖花了20块', 'expense.entertainment.games'],
    ['KTV消费80元', 'expense.entertainment.ktv'],
    ['影院花了45元', 'expense.entertainment.movies'],
    ['电玩城玩了30块', 'expense.entertainment.games'],
    ['沙县小吃吃饭花20元', 'expense.food.other'],
    ['医院挂号花15元', 'expense.healthcare.outpatient'],
    ['书店买教材花50元', 'expense.education.books'],
  ] as const)(
    'maps concepts across venue, item, service and activity domains: %s',
    (text, subcategoryKey) => {
      expect(resolveExpense(text)).toMatchObject({
        status: 'RESOLVED',
        subcategoryKey,
        source: 'SEMANTIC_ONTOLOGY',
      });
    },
  );

  it('recognizes colloquial bare water only when it has a purchased-item role', () => {
    expect(resolveExpense('在网吧买水花了3元，微信付的')).toMatchObject({
      status: 'RESOLVED',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.drinks',
      explicit: true,
    });
    for (const text of ['买水果花了10元', '交水费花了20元']) {
      expect(
        collectSemanticCategoryProposals(text, { transactionType: 'EXPENSE' })
          .proposals,
      ).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ subcategoryKey: 'expense.food.drinks' }),
        ]),
      );
    }
  });

  it.each([
    '在网吧修电脑花100元，微信付的',
    '在网吧退电脑花100元，微信付的',
    '在网吧租电脑花100元，微信付的',
    '在网吧借电脑花100元，微信付的',
  ])('blocks a venue default for non-purchase item roles: %s', text => {
    const result = resolveExpense(text);
    expect(result).toMatchObject({
      status: 'AMBIGUOUS',
      ambiguityReasons: expect.arrayContaining([
        expect.stringContaining('非购买关系'),
      ]),
    });
    expect(result.categoryKey).toBeUndefined();
  });

  it('treats a purchased membership card as stored value before venue classification', () => {
    expect(resolveExpense('在餐厅买会员卡花100元，微信付的')).toMatchObject({
      status: 'ABSTAINED',
      riskSignals: expect.arrayContaining([
        expect.objectContaining({ kind: 'STORED_VALUE_OR_TOP_UP' }),
      ]),
    });
  });

  it('does not mistake a refund handling fee for a refund event', () => {
    expect(resolveExpense('退款手续费花了2元')).toMatchObject({
      status: 'NO_MATCH',
      riskSignals: [],
    });
  });

  it.each([
    [
      '在网吧买了瓶水10元',
      'expense.food',
      'expense.food.drinks',
      'EXPLICIT_ITEM',
    ],
    [
      '去网吧买鼠标花了50元',
      'expense.shopping',
      'expense.shopping.electronics',
      'EXPLICIT_ITEM',
    ],
    [
      '打车去网吧花了10元',
      'expense.transport',
      'expense.transport.taxi',
      'EXPLICIT_SERVICE',
    ],
    [
      '去网吧上网花10元',
      'expense.entertainment',
      'expense.entertainment.games',
      'EXPLICIT_ACTIVITY',
    ],
    [
      '在电影院买爆米花花了18元',
      'expense.food',
      'expense.food.snacks',
      'EXPLICIT_ITEM',
    ],
    [
      '在医院买矿泉水花3元',
      'expense.food',
      'expense.food.drinks',
      'EXPLICIT_ITEM',
    ],
  ] as const)(
    'lets an explicit consumed object or purpose override a venue default: %s',
    (text, categoryKey, subcategoryKey, proposalKind) => {
      const result = resolveExpense(text);
      expect(result).toMatchObject({
        status: 'RESOLVED',
        categoryKey,
        subcategoryKey,
        explicit: true,
        proposal: { proposalKind },
      });
    },
  );

  it.each([
    ['网吧充了100元', 'STORED_VALUE_OR_TOP_UP'],
    ['网吧交了50元押金', 'DEPOSIT_OR_GUARANTEE'],
    ['网吧退款10元', 'REFUND_OR_REVERSAL'],
    ['给网吧转账10元', 'TRANSFER_OR_ACCOUNT_MOVEMENT'],
    ['我把鼠标卖给网吧收了20元', 'POSSIBLE_INCOME'],
  ] as const)(
    'abstains for transaction-semantics risks: %s',
    (text, riskKind) => {
      expect(resolveExpense(text)).toMatchObject({
        status: 'ABSTAINED',
        confidence: 0,
        riskSignals: expect.arrayContaining([
          expect.objectContaining({ kind: riskKind }),
        ]),
      });
    },
  );

  it.each(['INCOME', 'TRANSFER', 'REFUND', 'REIMBURSEMENT', 'LOAN'] as const)(
    'does not let an expense ontology overwrite a %s event',
    transactionType => {
      expect(
        resolveSemanticCategory('网吧消费10元', { transactionType }),
      ).toMatchObject({
        status: 'ABSTAINED',
        riskSignals: expect.arrayContaining([
          expect.objectContaining({ kind: 'NON_EXPENSE_TRANSACTION' }),
        ]),
      });
    },
  );

  it('suppresses a negated venue instead of treating every mention as consumption', () => {
    const collected = collectSemanticCategoryProposals(
      '今天没去网吧，买矿泉水花了2元',
      { transactionType: 'EXPENSE' },
    );
    expect(collected.suppressedEvidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conceptId: 'venue.internet_cafe',
          suppressedBy: 'NEGATION',
        }),
      ]),
    );
    expect(resolveExpense('今天没去网吧，买矿泉水花了2元')).toMatchObject({
      status: 'RESOLVED',
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.drinks',
    });
  });

  it('also suppresses a venue when the cancellation appears after the mention', () => {
    expect(resolveExpense('本来想去网吧消费10元但没去')).toMatchObject({
      status: 'NO_MATCH',
      suppressedEvidence: expect.arrayContaining([
        expect.objectContaining({ conceptId: 'venue.internet_cafe' }),
      ]),
    });
  });

  it.each(['淘宝买网吧代金券20元', '买网吧会员卡100元', '买网吧股票100元'])(
    'does not confuse a venue name used as an object with a visit: %s',
    text => {
      const proposals = collectSemanticCategoryProposals(text, {
        transactionType: 'EXPENSE',
      }).proposals;
      expect(proposals).not.toEqual(
        expect.arrayContaining([
          expect.objectContaining({ categoryKey: 'expense.entertainment' }),
        ]),
      );
    },
  );

  it('understands seller-to-speaker wording as purchasing an item, not speaker income', () => {
    expect(resolveExpense('网吧卖给我二手显卡500元')).toMatchObject({
      status: 'RESOLVED',
      categoryKey: 'expense.shopping',
      subcategoryKey: 'expense.shopping.electronics',
      riskSignals: [],
    });
  });

  it.each([
    [
      '在网吧用电脑上网花10元',
      'expense.entertainment',
      'expense.entertainment.games',
    ],
    [
      '带耳机去KTV唱歌花50元',
      'expense.entertainment',
      'expense.entertainment.ktv',
    ],
  ] as const)(
    'distinguishes a used or carried item from a purchased item: %s',
    (text, categoryKey, subcategoryKey) => {
      expect(resolveExpense(text)).toMatchObject({
        status: 'RESOLVED',
        categoryKey,
        subcategoryKey,
      });
    },
  );

  it.each(['手机上网流量30元', '交宽带费上网100元', '酒店包夜200元'])(
    'requires internet-cafe context before treating online activity as entertainment: %s',
    text => {
      expect(resolveExpense(text)).toMatchObject({ status: 'NO_MATCH' });
    },
  );

  it('requires a known expense type and abstains when transaction type is unknown', () => {
    expect(resolveSemanticCategory('在网吧消费10元')).toMatchObject({
      status: 'ABSTAINED',
      riskSignals: expect.arrayContaining([
        expect.objectContaining({ kind: 'NON_EXPENSE_TRANSACTION' }),
      ]),
    });
  });

  it('keeps evidence and losing proposals available for explanation and later arbitration', () => {
    const result = resolveExpense('打车去网咖花了10元');
    expect(result.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          conceptId: 'service.taxi',
          role: 'PAID_SERVICE',
          matchedText: '打车',
        }),
      ]),
    );
    expect(result.alternatives).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          categoryKey: 'expense.entertainment',
          subcategoryKey: 'expense.entertainment.games',
        }),
      ]),
    );
  });

  it('fails closed if an unsplit sentence clearly contains two paid purposes', () => {
    expect(resolveExpense('打车花10元，然后看电影花40元')).toMatchObject({
      status: 'AMBIGUOUS',
      ambiguityReasons: expect.arrayContaining([
        expect.stringContaining('多笔'),
      ]),
      alternatives: expect.arrayContaining([
        expect.objectContaining({ categoryKey: 'expense.transport' }),
        expect.objectContaining({ categoryKey: 'expense.entertainment' }),
      ]),
    });
  });

  it('returns NO_MATCH instead of inventing a category for an unknown concept', () => {
    expect(resolveExpense('今天处理了一件事情10元')).toEqual(
      expect.objectContaining({
        status: 'NO_MATCH',
        alternatives: [],
        evidence: [],
      }),
    );
  });
});
