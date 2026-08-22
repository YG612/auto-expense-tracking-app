package com.qingjiai.notifications

internal object PaymentNotificationClassifier {
  private val allowedPackages = setOf(
    "com.tencent.mm",
    "com.eg.android.AlipayGphone",
  )

  private val paymentCues = listOf(
    "支付成功",
    "成功支付",
    "付款成功",
    "成功付款",
    "已付款",
    "消费成功",
    "扣款成功",
    "扣款通知",
    "微信支付凭证",
    "收款到账",
    "收款成功",
    "收钱到账",
    "二维码收款",
    "到账通知",
    "退款成功",
    "退款到账",
    "退款已到账",
    "转账成功",
  )

  private val providerTitles = mapOf(
    "com.tencent.mm" to listOf("微信支付", "微信收款助手", "支付通知"),
    "com.eg.android.AlipayGphone" to listOf("支付宝", "收钱到账", "支付助手"),
  )

  fun isCandidate(
    packageName: String,
    title: String,
    text: String,
    conversationLike: Boolean,
  ): Boolean {
    if (packageName !in allowedPackages || (title.isBlank() && text.isBlank())) return false
    val combined = "$title\n$text"
    if (paymentCues.none(combined::contains)) return false
    if (!conversationLike) return true
    return providerTitles[packageName].orEmpty().any { title.contains(it) }
  }
}
