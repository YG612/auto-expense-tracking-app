import {
  generateCounterpartyCandidates,
  hasCounterpartyTransactionEvidence,
  modelEligibleCounterpartyCandidates,
  resolveCounterpartyFromRules,
} from '../classification/counterparty/counterpartyExtractor';

describe('counterparty extraction', () => {
  it('extracts the service provider but not travel locations', () => {
    expect(
      resolveCounterpartyFromRules('说今天从武汉到上海买的动车票花了270元'),
    ).toBeUndefined();
    expect(
      resolveCounterpartyFromRules('铁路12306消费270元，今天从武汉到上海坐动车')
        ?.text,
    ).toBe('铁路12306');
    expect(
      modelEligibleCounterpartyCandidates(
        '说今天从武汉到上海买的动车票花了270元',
      ),
    ).toEqual([]);
    for (const routeOnlyText of [
      '今天从武汉到上海花了270元',
      '从北京到天津支付55元车费',
      '从上海到上海花了20元',
    ]) {
      expect(resolveCounterpartyFromRules(routeOnlyText)).toBeUndefined();
    }
  });

  it('keeps an explicit travel provider while rejecting route locations', () => {
    expect(resolveCounterpartyFromRules('付给春运旅行社270元买票')?.text).toBe(
      '春运旅行社',
    );
  });

  it('keeps explicit, direct, income and provider role boundaries', () => {
    expect(
      resolveCounterpartyFromRules('商家名称：青禾餐厅，金额68元')?.text,
    ).toBe('青禾餐厅');
    expect(resolveCounterpartyFromRules('付给季明共68元')?.text).toBe('季明');
    expect(
      resolveCounterpartyFromRules('收到开元咨询集团发的工资10860元')?.text,
    ).toBe('开元咨询集团');
    expect(
      resolveCounterpartyFromRules('订单由青禾餐厅提供，结账68元')?.text,
    ).toBe('青禾餐厅');
    expect(
      resolveCounterpartyFromRules('工资10060元由晨星公益基金会汇入')?.text,
    ).toBe('晨星公益基金会');
  });

  it('prefers the actual provider or venue over a payment platform', () => {
    expect(
      resolveCounterpartyFromRules('在青禾餐厅通过美团支付68元')?.text,
    ).toBe('青禾餐厅');
    expect(
      resolveCounterpartyFromRules('订单由青禾餐厅提供，美团支付68元')?.text,
    ).toBe('青禾餐厅');
    expect(resolveCounterpartyFromRules('美团支付68元')?.text).toBe('美团');
  });

  it('rejects hard negatives and incomplete transactions', () => {
    for (const text of [
      '在青禾餐厅门口流动摊消费68元',
      '购买青禾餐厅礼品卡充值68元',
      '给季明买礼物花68元',
      '原计划在青禾餐厅消费68元，最后没有消费',
      '支付宝显示支出68元，商户字段缺失',
      '到账100元',
      '入账100元',
      '收款成功100元',
    ]) {
      expect(resolveCounterpartyFromRules(text)).toBeUndefined();
    }
  });

  it('does not emit temporal or missing-value placeholders as candidates', () => {
    const texts = generateCounterpartyCandidates('昨晚打款给艾青68元').map(
      candidate => candidate.text,
    );
    expect(texts).toContain('艾青');
    expect(texts).not.toContain('昨晚');
    expect(hasCounterpartyTransactionEvidence('艾青给我打过来68元')).toBe(true);
  });
});
