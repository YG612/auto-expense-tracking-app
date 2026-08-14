import {
  enrichCandidatesWithOnDeviceModel,
  preprocessBillClassifierText,
} from '../classification/model';
import type {
  OnDeviceBillClassifierPort,
  OnDeviceCategoryPrediction,
} from '../classification/model';
import type { ParsedTransactionCandidate } from '../classification/types';
import { reviewDisposition } from '../domain/services/reviewDisposition';

function candidate(
  update: Partial<ParsedTransactionCandidate> = {},
): ParsedTransactionCandidate {
  return {
    type: 'EXPENSE',
    amountMinor: 2500,
    currency: 'CNY',
    occurredAt: '2026-08-15T12:00:00.000Z',
    accountKey: 'WECHAT',
    tags: [],
    confidence: 0.62,
    missingFields: ['分类'],
    ambiguityReasons: [],
    categoryAlternatives: [],
    confidenceLevel: 'LOW',
    suggestionSource: 'DEFAULT',
    originalText: '公司楼下吃盖饭25元，微信支付',
    sourceText: '公司楼下吃盖饭25元，微信支付',
    ...update,
  };
}

function classifier(
  prediction: OnDeviceCategoryPrediction,
): OnDeviceBillClassifierPort {
  return {
    status: async () => ({ available: true, loaded: true }),
    classify: async () => prediction,
    close: async () => undefined,
  };
}

const foodPrediction: OnDeviceCategoryPrediction = {
  modelId: 'qingji-bill-category-fasttext',
  modelVersion: '0.1.0-bootstrap',
  taxonomyVersion: 2,
  parentCategoryKey: 'expense.food',
  subcategoryKey: 'expense.food.lunch',
  top1Probability: 0.96,
  top2Probability: 0.02,
  calibratedConfidence: 0.96,
  abstained: false,
  latencyMs: 4,
};

describe('on-device bill classification', () => {
  it('minimizes volatile and identifying transaction fields before inference', () => {
    expect(
      preprocessBillClassifierText(
        '今天 微信支付 订单号:ABCDEF123456 午饭25.50元',
      ),
    ).toBe('<DATE> <ACCOUNT> <ORDER> 午饭 <AMOUNT>');
  });

  it('fills a missing category without allowing direct confirmation', async () => {
    const [result] = await enrichCandidatesWithOnDeviceModel(
      [candidate()],
      classifier(foodPrediction),
    );

    expect(result).toMatchObject({
      categoryKey: 'expense.food',
      subcategoryKey: 'expense.food.lunch',
      suggestionSource: 'ON_DEVICE_MODEL',
      missingFields: [],
      confidenceLevel: 'MEDIUM',
      onDeviceModel: {
        modelVersion: '0.1.0-bootstrap',
        calibratedConfidence: 0.96,
      },
    });
    expect(result.advisoryReasons).toContain('分类由端侧 AI 建议，请确认');
    expect(reviewDisposition(result)).toBe('REVIEW_CONFIRM');
  });

  it('preserves explicit, risky, abstained and failed results', async () => {
    const explicit = candidate({
      categoryKey: 'expense.shopping',
      suggestionSource: 'EXPLICIT_TEXT',
      missingFields: [],
    });
    const risky = candidate({ ambiguityReasons: ['个人收款无法可靠分类'] });
    const failed: OnDeviceBillClassifierPort = {
      status: async () => ({ available: false, loaded: false }),
      classify: async () => {
        throw new Error('missing');
      },
      close: async () => undefined,
    };

    expect(
      await enrichCandidatesWithOnDeviceModel(
        [explicit, risky],
        classifier(foodPrediction),
      ),
    ).toEqual([explicit, risky]);
    expect(
      await enrichCandidatesWithOnDeviceModel(
        [candidate()],
        classifier({ ...foodPrediction, abstained: true }),
      ),
    ).toEqual([candidate()]);
    expect(
      await enrichCandidatesWithOnDeviceModel([candidate()], failed),
    ).toEqual([candidate()]);
  });

  it('rejects a model label from the wrong transaction direction', async () => {
    const [result] = await enrichCandidatesWithOnDeviceModel(
      [candidate()],
      classifier({
        ...foodPrediction,
        parentCategoryKey: 'income.salary',
        subcategoryKey: undefined,
      }),
    );
    expect(result).toEqual(candidate());
  });
});
