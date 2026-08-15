package com.qingjiai.notifications

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PaymentNotificationClassifierTest {
  @Test
  fun acceptsWechatAndAlipayPaymentResults() {
    assertTrue(
      PaymentNotificationClassifier.isCandidate(
        "com.tencent.mm",
        "微信支付",
        "付款成功 12.80元",
        false,
      ),
    )
    assertTrue(
      PaymentNotificationClassifier.isCandidate(
        "com.eg.android.AlipayGphone",
        "支付宝",
        "收款到账 18.50元",
        false,
      ),
    )
  }

  @Test
  fun rejectsOtherPackagesAndWechatChatMessages() {
    assertFalse(
      PaymentNotificationClassifier.isCandidate(
        "com.example.fake",
        "支付宝",
        "支付成功 100元",
        false,
      ),
    )
    assertFalse(
      PaymentNotificationClassifier.isCandidate(
        "com.tencent.mm",
        "张三",
        "我这边付款成功了，金额 100 元",
        true,
      ),
    )
  }

  @Test
  fun allowsOfficialWechatPaymentConversationStyleNotification() {
    assertTrue(
      PaymentNotificationClassifier.isCandidate(
        "com.tencent.mm",
        "微信支付",
        "微信支付凭证 付款金额￥25.00",
        true,
      ),
    )
  }
}
