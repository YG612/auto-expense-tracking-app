export type MerchantInstitutionRecognition = {
  institutionId: string;
  canonicalName: string;
  matchedName: string;
  categoryKey: string;
  subcategoryKey?: string;
};

type MerchantInstitutionRule = Omit<
  MerchantInstitutionRecognition,
  'matchedName'
> & {
  aliases: readonly RegExp[];
  excludedContext?: RegExp;
};

const VOUCHER_OR_BRAND_OBJECT =
  /速冻|冷冻|预制|半成品|调料|代金券|优惠券|礼品卡|会员卡|股票|基金|债券|周边|玩具|联名/u;

/**
 * High-precision, local-only institution aliases. Rules intentionally cover
 * specialized providers. General marketplaces, malls, supermarkets and
 * convenience stores remain ambiguous because their receipts span categories.
 */
export const MERCHANT_INSTITUTION_RULES: readonly MerchantInstitutionRule[] = [
  {
    institutionId: 'food.delivery',
    canonicalName: '外卖平台',
    aliases: [/美团外卖/u, /饿了么/u, /拉扎斯(?:网络科技)?/u],
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.delivery',
  },
  {
    institutionId: 'food.coffee_tea_chains',
    canonicalName: '咖啡茶饮连锁',
    aliases: [
      /瑞幸(?:咖啡)?/u,
      /库迪(?:咖啡)?/u,
      /星巴克/u,
      /蜜雪冰城/u,
      /喜茶/u,
      /奈雪(?:的茶)?/u,
      /霸王茶姬/u,
      /茶百道/u,
      /古茗/u,
      /沪上阿姨/u,
      /书亦烧仙草/u,
      /甜啦啦/u,
      /幸运咖/u,
    ],
    excludedContext: VOUCHER_OR_BRAND_OBJECT,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.coffee_tea',
  },
  {
    institutionId: 'food.restaurant_chains',
    canonicalName: '餐饮连锁',
    aliases: [
      /肯德基/u,
      /麦当劳/u,
      /必胜客/u,
      /华莱士/u,
      /德克士/u,
      /塔斯汀/u,
      /永和大王/u,
      /海底捞/u,
      /杨国福(?:麻辣烫)?/u,
      /张亮麻辣烫/u,
      /正新鸡排/u,
      /绝味(?:鸭脖)?/u,
      /沙县小吃/u,
    ],
    excludedContext: VOUCHER_OR_BRAND_OBJECT,
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.other',
  },
  {
    institutionId: 'food.grocery_delivery',
    canonicalName: '生鲜买菜平台',
    aliases: [
      /叮咚买菜/u,
      /上海壹佰米网络科技/u,
      /朴朴(?:科技|超市)?/u,
      /小象超市/u,
      /盒马鲜生/u,
    ],
    categoryKey: 'expense.food',
    subcategoryKey: 'expense.food.groceries',
  },
  {
    institutionId: 'transport.ride_hailing',
    canonicalName: '网约车平台',
    aliases: [
      /滴滴(?:出行)?/u,
      /滴滴出行科技/u,
      /T3出行/iu,
      /南京领行科技/u,
      /曹操出行/u,
      /杭州优行科技/u,
      /首汽约车/u,
      /首约科技/u,
      /享道出行/u,
      /上海赛可出行/u,
      /如祺出行/u,
      /广州祺宸科技/u,
      /阳光出行/u,
      /花小猪(?:打车|出行)?/u,
      /万顺叫车/u,
      /喜行约车/u,
      /高德打车/u,
    ],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.taxi',
  },
  {
    institutionId: 'transport.rail',
    canonicalName: '中国铁路',
    aliases: [
      /铁路12306/iu,
      /中国铁路/u,
      /国铁吉讯/u,
      /铁旅科技/u,
      /铁路局集团/u,
    ],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.train',
  },
  {
    institutionId: 'transport.metro',
    canonicalName: '城市轨道交通',
    aliases: [
      /轨道交通(?:集团|运营|有限公司)/u,
      /地铁(?:集团|运营|有限公司)/u,
      /申通地铁/u,
    ],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.metro',
  },
  {
    institutionId: 'transport.public_bus',
    canonicalName: '公共交通机构',
    aliases: [
      /公共交通/u,
      /公交(?:集团|公司)/u,
      /客运(?:集团|公司)/u,
      /交通运输(?:集团|公司)/u,
    ],
    categoryKey: 'expense.transport',
  },
  {
    institutionId: 'transport.shared_bike',
    canonicalName: '共享单车',
    aliases: [/哈啰单车/u, /青桔单车/u, /美团单车/u],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.shared_bike',
  },
  {
    institutionId: 'transport.airline',
    canonicalName: '航空公司',
    aliases: [
      /中国国际航空|中国国航/u,
      /中国南方航空|南方航空/u,
      /中国东方航空|东方航空/u,
      /海南航空/u,
      /深圳航空/u,
      /厦门航空/u,
      /四川航空/u,
      /春秋航空/u,
      /吉祥航空/u,
      /山东航空/u,
    ],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.flight',
  },
  {
    institutionId: 'transport.fuel',
    canonicalName: '加油站',
    aliases: [
      /中国石化/u,
      /中石化/u,
      /中国石油(?!大学)/u,
      /中石油/u,
      /中国海油|中海油/u,
      /壳牌(?:加油站|石油)?/u,
      /加油站/u,
    ],
    categoryKey: 'expense.transport',
    subcategoryKey: 'expense.transport.fuel',
  },
  {
    institutionId: 'travel.booking',
    canonicalName: '旅行预订平台',
    aliases: [
      /携程旅行/u,
      /去哪儿旅行/u,
      /飞猪旅行/u,
      /同程旅行/u,
      /途牛旅游/u,
    ],
    categoryKey: 'expense.travel',
  },
  {
    institutionId: 'healthcare.dental',
    canonicalName: '口腔医疗机构',
    aliases: [/口腔(?:医院|门诊|诊所|医疗)/u, /牙科(?:医院|门诊|诊所)?/u],
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.dental',
  },
  {
    institutionId: 'healthcare.ophthalmology',
    canonicalName: '眼科医疗机构',
    aliases: [/眼科(?:医院|门诊|诊所|医疗)/u, /爱尔眼科/u],
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.ophthalmology',
  },
  {
    institutionId: 'healthcare.checkup',
    canonicalName: '体检机构',
    aliases: [/体检中心/u, /美年大健康/u, /爱康国宾/u, /慈铭体检/u],
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.checkup',
  },
  {
    institutionId: 'healthcare.pharmacy',
    canonicalName: '连锁药房',
    aliases: [
      /大参林/u,
      /益丰(?:大药房|药房)?/u,
      /老百姓大药房/u,
      /一心堂/u,
      /国大药房/u,
      /海王星辰/u,
      /漱玉平民/u,
      /健之佳/u,
      /张仲景大药房/u,
      /同仁堂/u,
      /叮当智慧药房/u,
      /大药房/u,
      /医药连锁/u,
      /健康药房/u,
    ],
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.medicine',
  },
  {
    institutionId: 'pets.medical',
    canonicalName: '宠物医疗机构',
    aliases: [/宠物医院/u, /动物医院/u, /宠物诊所/u],
    categoryKey: 'expense.pets',
    subcategoryKey: 'expense.pets.medical',
  },
  {
    institutionId: 'healthcare.outpatient',
    canonicalName: '医疗机构',
    aliases: [/医院/u, /门诊部/u, /医疗诊所/u],
    categoryKey: 'expense.healthcare',
    subcategoryKey: 'expense.healthcare.outpatient',
  },
  {
    institutionId: 'housing.electricity',
    canonicalName: '供电机构',
    aliases: [
      /国家电网/u,
      /南方电网/u,
      /供电(?:局|公司)/u,
      /电力(?:集团|公司)/u,
    ],
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.electricity',
  },
  {
    institutionId: 'housing.water',
    canonicalName: '供水机构',
    aliases: [
      /自来水(?:集团|公司)?/u,
      /水务(?:集团|公司)/u,
      /供水(?:集团|公司)/u,
    ],
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.water',
  },
  {
    institutionId: 'housing.gas',
    canonicalName: '燃气机构',
    aliases: [/燃气(?:集团|公司)/u, /华润燃气/u, /港华燃气/u, /新奥燃气/u],
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.gas',
  },
  {
    institutionId: 'housing.property',
    canonicalName: '物业服务机构',
    aliases: [/物业(?:管理|服务)?(?:集团|有限公司|公司)/u],
    categoryKey: 'expense.housing',
    subcategoryKey: 'expense.housing.property_management',
  },
  {
    institutionId: 'communication.carriers',
    canonicalName: '基础电信运营商',
    aliases: [
      /中国移动(?:通信)?/u,
      /中国联通/u,
      /中国电信/u,
      /移动通信集团/u,
      /联通(?:通信)?(?:集团|公司)/u,
      /电信(?:集团|公司)/u,
    ],
    categoryKey: 'expense.communication',
    subcategoryKey: 'expense.communication.phone_bill',
  },
  {
    institutionId: 'entertainment.video_membership',
    canonicalName: '视频会员平台',
    aliases: [/腾讯视频/u, /爱奇艺/u, /优酷视频/u, /芒果TV/iu, /搜狐视频/u],
    categoryKey: 'expense.entertainment',
    subcategoryKey: 'expense.entertainment.video_membership',
  },
  {
    institutionId: 'entertainment.music_membership',
    canonicalName: '音乐会员平台',
    aliases: [/QQ音乐/iu, /网易云音乐/u, /酷狗音乐/u, /酷我音乐/u],
    categoryKey: 'expense.entertainment',
    subcategoryKey: 'expense.entertainment.music_membership',
  },
  {
    institutionId: 'education.training',
    canonicalName: '教育培训机构',
    aliases: [
      /新东方(?:教育)?/u,
      /学而思/u,
      /猿辅导/u,
      /作业帮/u,
      /粉笔教育/u,
      /中公教育/u,
      /华图教育/u,
    ],
    categoryKey: 'expense.education',
    subcategoryKey: 'expense.education.courses',
  },
] as const;

export function recognizeMerchantInstitution(
  text: string,
): MerchantInstitutionRecognition | undefined {
  for (const rule of MERCHANT_INSTITUTION_RULES) {
    if (rule.excludedContext?.test(text) === true) continue;
    for (const alias of rule.aliases) {
      const matchedName = alias.exec(text)?.[0];
      if (matchedName !== undefined) {
        return {
          institutionId: rule.institutionId,
          canonicalName: rule.canonicalName,
          matchedName,
          categoryKey: rule.categoryKey,
          subcategoryKey: rule.subcategoryKey,
        };
      }
    }
  }
  return undefined;
}
