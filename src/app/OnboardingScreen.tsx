import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

const PAGES = [
  {
    eyebrow: '01 · 数据边界',
    title: '账本默认只在你的设备上',
    body: '交易、分类习惯与统计均在本机处理。轻记 AI 不要求注册账号，也不会自动上传账本。',
  },
  {
    eyebrow: '02 · 智能但可控',
    title: '识别结果先确认，再入账',
    body: '文字或语音会生成候选交易；金额、分类、账户和疑似重复都可以在保存前复核。',
  },
  {
    eyebrow: '03 · 你的备份责任',
    title: '本地优先，也意味着要主动备份',
    body: '卸载应用或设备损坏可能丢失本机数据。记下第一笔后，我们会提醒你创建带口令的加密备份。',
  },
] as const;

export function OnboardingScreen({
  onComplete,
}: {
  onComplete(): Promise<void>;
}) {
  const [page, setPage] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const content = PAGES[page]!;

  const complete = async () => {
    setSaving(true);
    setError(undefined);
    try {
      await onComplete();
    } catch {
      setError('保存引导状态失败，请重试。');
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <View style={styles.content}>
        <View style={styles.brandMark}>
          <Text style={styles.brandMarkText}>轻</Text>
        </View>
        <View style={styles.copy}>
          <Text style={styles.eyebrow}>{content.eyebrow}</Text>
          <Text accessibilityRole="header" style={styles.title}>
            {content.title}
          </Text>
          <Text style={styles.body}>{content.body}</Text>
        </View>
        <View
          accessibilityLabel={`第 ${page + 1} 页，共 3 页`}
          style={styles.dots}
        >
          {PAGES.map((_, index) => (
            <View
              key={index}
              style={[styles.dot, index === page && styles.dotActive]}
            />
          ))}
        </View>
        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}
        <View style={styles.actions}>
          {page < PAGES.length - 1 ? (
            <Pressable
              accessibilityRole="button"
              disabled={saving}
              onPress={complete}
              style={styles.secondaryButton}
            >
              <Text style={styles.secondaryText}>跳过引导</Text>
            </Pressable>
          ) : null}
          <Pressable
            accessibilityRole="button"
            disabled={saving}
            onPress={() =>
              page === PAGES.length - 1
                ? complete()
                : setPage(value => value + 1)
            }
            style={styles.primaryButton}
          >
            <Text style={styles.primaryText}>
              {saving
                ? '正在保存…'
                : page === PAGES.length - 1
                  ? '开始记账'
                  : '下一步'}
            </Text>
          </Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    flex: 1,
    justifyContent: 'center',
    gap: spacing.xl,
    padding: spacing.xl,
  },
  brandMark: {
    width: 72,
    height: 72,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.xl,
    backgroundColor: colors.brand,
    ...shadows.card,
  },
  brandMarkText: { color: colors.white, fontSize: 32, fontWeight: '900' },
  copy: { gap: spacing.sm },
  eyebrow: {
    color: colors.brand,
    fontSize: typography.caption,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  title: {
    color: colors.ink,
    fontSize: 31,
    fontWeight: '900',
    lineHeight: 41,
  },
  body: { color: colors.inkSecondary, fontSize: 16, lineHeight: 26 },
  dots: { flexDirection: 'row', gap: spacing.xs },
  dot: {
    width: 8,
    height: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.borderStrong,
  },
  dotActive: { width: 28, backgroundColor: colors.brand },
  error: { color: colors.expenseText, lineHeight: 20 },
  actions: { flexDirection: 'row', gap: spacing.sm },
  primaryButton: {
    minHeight: 52,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
  },
  primaryText: { color: colors.white, fontWeight: '900' },
  secondaryButton: {
    minHeight: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
  },
  secondaryText: { color: colors.inkSecondary, fontWeight: '800' },
});
