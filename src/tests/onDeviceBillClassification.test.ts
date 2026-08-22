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

  it('can suggest a category when the only unresolved issue is amount parsing', async () => {
    const amountAmbiguous = candidate({
      amountMinor: undefined,
      missingFields: ['金额', '分类'],
      ambiguityReasons: [
        '同一条描述中存在多个不同金额且未明确总价，请补充实付金额',
      ],
    });

    const [result] = await enrichCandidatesWithOnDeviceModel(
      [amountAmbiguous],
      classifier(foodPrediction),
    );

    expect(result).toMatchObject({
      amountMinor: undefined,
      categoryKey: 'expense.food',
      missingFields: ['金额'],
      ambiguityReasons: amountAmbiguous.ambiguityReasons,
      suggestionSource: 'ON_DEVICE_MODEL',
    });
    expect(reviewDisposition(result)).toBe('EDIT_ONLY');
  });

  it('still blocks model suggestions for unknown or category-related ambiguity', async () => {
    const unknownRisk = candidate({
      ambiguityReasons: ['新增的未知语义风险，必须默认阻断'],
    });
    expect(
      await enrichCandidatesWithOnDeviceModel(
        [unknownRisk],
        classifier(foodPrediction),
      ),
    ).toEqual([unknownRisk]);
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

  it('accepts the unified income label without inventing an income category', async () => {
    const income = candidate({
      type: 'INCOME',
      originalText: '工资到账8000元',
      sourceText: '工资到账8000元',
    });
    const [result] = await enrichCandidatesWithOnDeviceModel(
      [income],
      classifier({
        ...foodPrediction,
        parentCategoryKey: 'income',
        subcategoryKey: undefined,
      }),
    );
    expect(result).toMatchObject({
      type: 'INCOME',
      direction: 'INCOME',
      classificationLabel: 'income',
      categoryKey: undefined,
      subcategoryKey: undefined,
      suggestionSource: 'ON_DEVICE_MODEL',
    });
  });

  it('uses the counterparty head only as an advisory enrichment', async () => {
    const model = classifier(foodPrediction);
    model.scoreCounterpartyCandidates = async modelTexts =>
      modelTexts.map(text => ({
        primaryProbability: text.includes('候选文本 古茗') ? 0.91 : 0.01,
        notCounterpartyProbability: text.includes('候选文本 古茗')
          ? 0.09
          : 0.99,
        threshold: 0.05,
        modelVersion: '1.0.0-synthetic',
        latencyMs: 1,
      }));
    const input = candidate({
      categoryKey: 'expense.food',
      missingFields: [],
      suggestionSource: 'EXPLICIT_TEXT',
      originalText: '微信付款18元，古茗消费',
      sourceText: '微信付款18元，古茗消费',
    });
    const [result] = await enrichCandidatesWithOnDeviceModel([input], model);
    expect(result.merchantRawName).toBe('古茗');
    expect(result.advisoryReasons).toContain(
      '商户 / 对象由端侧 AI 建议，请确认',
    );
    expect(result.suggestionSource).toBe('EXPLICIT_TEXT');
  });

  it('does not send hard-rejected route locations or tickets to the model', async () => {
    const scoreCounterpartyCandidates = jest.fn(async () => []);
    const model = classifier(foodPrediction);
    model.scoreCounterpartyCandidates = scoreCounterpartyCandidates;
    const input = candidate({
      categoryKey: 'expense.transport',
      subcategoryKey: 'expense.transport.train',
      missingFields: [],
      suggestionSource: 'EXPLICIT_TEXT',
      originalText: '说今天从武汉到上海买的动车票花了270',
      sourceText: '说今天从武汉到上海买的动车票花了270',
    });

    const [result] = await enrichCandidatesWithOnDeviceModel([input], model);

    expect(result.merchantRawName).toBeUndefined();
    expect(scoreCounterpartyCandidates).not.toHaveBeenCalled();
  });
});
