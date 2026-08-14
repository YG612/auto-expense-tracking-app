import { recognizeTransactionType } from '../classification/rules/localRules';
import { recognizeMerchantInstitution } from '../classification/rules/merchantInstitutionRules';

describe('common merchant institution rules', () => {
  it.each([
    ['上海拉扎斯网络科技有限公司', 'expense.food.delivery'],
    ['霸王茶姬上海静安店', 'expense.food.coffee_tea'],
    ['正新鸡排华南门店', 'expense.food.other'],
    ['上海壹佰米网络科技有限公司', 'expense.food.groceries'],
    ['南京领行科技股份有限公司', 'expense.transport.taxi'],
    ['中国铁路12306', 'expense.transport.train'],
    ['深圳市地铁集团有限公司', 'expense.transport.metro'],
    ['春秋航空股份有限公司', 'expense.transport.flight'],
    ['中国石化销售股份有限公司', 'expense.transport.fuel'],
    ['携程旅行网', 'expense.travel'],
    ['益丰大药房连锁股份有限公司', 'expense.healthcare.medicine'],
    ['爱尔眼科医院', 'expense.healthcare.ophthalmology'],
    ['某某宠物医院', 'expense.pets.medical'],
    ['国家电网有限公司', 'expense.housing.electricity'],
    ['某市水务集团有限公司', 'expense.housing.water'],
    ['中国移动通信集团有限公司', 'expense.communication.phone_bill'],
    ['爱奇艺会员服务', 'expense.entertainment.video_membership'],
    ['网易云音乐会员', 'expense.entertainment.music_membership'],
    ['新东方教育科技集团', 'expense.education.courses'],
  ])('recognizes %s as %s', (merchant, expectedCategory) => {
    const recognition = recognizeMerchantInstitution(merchant);
    expect(recognition?.subcategoryKey ?? recognition?.categoryKey).toBe(
      expectedCategory,
    );
    expect(recognizeTransactionType(`${merchant} 25元`)).toEqual({
      type: 'EXPENSE',
      explicit: true,
    });
  });

  it.each([
    '淘宝平台',
    '京东商城',
    '沃尔玛超市',
    '罗森便利店',
    '购买肯德基代金券',
    '中国石油大学',
  ])(
    'does not force a category for broad or non-merchant context: %s',
    text => {
      expect(recognizeMerchantInstitution(text)).toBeUndefined();
    },
  );

  it('preserves the matched brand instead of replacing it with a generic group name', () => {
    expect(recognizeMerchantInstitution('霸王茶姬上海静安店')).toMatchObject({
      canonicalName: '咖啡茶饮连锁',
      matchedName: '霸王茶姬',
    });
  });
});
