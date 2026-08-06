import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import {
  colors,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';

export function SettingsScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [learningEnabled, setLearningEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      setError(undefined);

      repositories.personalizationSettings
        .get()
        .then(settings => {
          if (active) {
            setLearningEnabled(settings.learningEnabled);
          }
        })
        .catch(loadError => {
          if (active) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : '读取个性化设置失败。',
            );
          }
        })
        .finally(() => {
          if (active) {
            setLoading(false);
          }
        });

      return () => {
        active = false;
      };
    }, [repositories]),
  );

  const changeLearning = async (enabled: boolean) => {
    const previous = learningEnabled;
    setLearningEnabled(enabled);
    setSaving(true);
    setError(undefined);
    try {
      await repositories.personalizationSettings.setLearningEnabled(
        enabled,
        new Date().toISOString(),
      );
    } catch (saveError) {
      setLearningEnabled(previous);
      setError(
        saveError instanceof Error ? saveError.message : '保存个性化设置失败。',
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.introCard}>
          <View style={styles.introHeader}>
            <View>
              <Text style={styles.introEyebrow}>隐私优先</Text>
              <Text accessibilityRole="header" style={styles.introTitle}>
                本地个性化
              </Text>
            </View>
            <View style={styles.privacyMark}>
              <MaterialDesignIcons
                color={colors.white}
                name="shield-lock-outline"
                size={29}
              />
            </View>
          </View>
          <Text style={styles.introText}>
            根据你确认后的分类纠正学习商户习惯。纠正记录、规则和匹配过程都只保存在本机。
          </Text>
        </View>

        <Text style={styles.sectionLabel}>智能学习</Text>
        <View style={styles.card}>
          <View style={styles.settingRow}>
            <View style={styles.settingCopy}>
              <Text style={styles.settingTitle}>自动学习纠正</Text>
              <Text style={styles.settingDescription}>
                同一商户连续 3 次被纠正为相同分类后，形成一条可管理的商户规则。
              </Text>
            </View>
            {loading ? (
              <ActivityIndicator color={colors.brand} />
            ) : (
              <Switch
                accessibilityLabel="自动学习纠正"
                disabled={saving}
                onValueChange={changeLearning}
                trackColor={{
                  false: colors.borderStrong,
                  true: colors.brandMuted,
                }}
                thumbColor={learningEnabled ? colors.brand : colors.surface}
                value={learningEnabled}
              />
            )}
          </View>
          <Text style={styles.pauseNotice}>
            暂停后不会记录新的纠正或生成学习规则；已有且已启用的规则仍会继续生效。
          </Text>
        </View>

        <Text style={styles.sectionLabel}>规则管理</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('RuleManagement')}
          style={styles.linkCard}
        >
          <View style={styles.ruleIcon}>
            <MaterialDesignIcons
              color={colors.brand}
              name="tune-variant"
              size={26}
            />
          </View>
          <View style={styles.linkCopy}>
            <Text style={styles.linkTitle}>分类规则</Text>
            <Text style={styles.linkDescription}>
              查看规则来源，新增商户或关键词规则，并可编辑、停用或删除。
            </Text>
          </View>
          <MaterialDesignIcons
            color={colors.brand}
            name="chevron-right"
            size={27}
          />
        </Pressable>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <View style={styles.scopeCard}>
          <Text style={styles.scopeTitle}>当前阶段边界</Text>
          <Text style={styles.scopeText}>
            本阶段只做本地纠正学习与规则管理，不读取 Android
            支付通知，也不会上传账本或规则。
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  content: {
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.lg,
    paddingBottom: spacing.xxl,
  },
  introCard: {
    gap: spacing.sm,
    overflow: 'hidden',
    borderRadius: radius.xl,
    backgroundColor: colors.brand,
    padding: spacing.lg,
    ...shadows.card,
  },
  introHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  introEyebrow: {
    color: colors.onBrandSubtle,
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1,
  },
  introTitle: {
    marginTop: 3,
    color: colors.white,
    fontSize: typography.pageTitle,
    fontWeight: '900',
  },
  introText: { color: colors.onBrandMuted, fontSize: 14, lineHeight: 22 },
  privacyMark: {
    width: 52,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.lg,
    backgroundColor: 'rgba(255, 255, 255, 0.14)',
  },
  sectionLabel: {
    marginTop: spacing.xs,
    marginLeft: spacing.xxs,
    color: colors.inkMuted,
    fontSize: typography.caption,
    fontWeight: '800',
    letterSpacing: 0.5,
  },
  card: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  settingCopy: { minWidth: 0, flex: 1, gap: 5 },
  settingTitle: { color: colors.ink, fontSize: 17, fontWeight: '800' },
  settingDescription: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 20,
  },
  pauseNotice: {
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
    color: colors.brandPressed,
    fontSize: 12,
    lineHeight: 18,
    padding: 10,
  },
  linkCard: {
    minHeight: 100,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  ruleIcon: {
    width: 48,
    height: 48,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.md,
    backgroundColor: colors.brandSoft,
  },
  linkCopy: { minWidth: 0, flex: 1, gap: 6 },
  linkTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  linkDescription: {
    color: colors.inkSecondary,
    fontSize: 13,
    lineHeight: 19,
  },
  error: {
    borderRadius: radius.sm,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: 12,
  },
  scopeCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: spacing.md,
  },
  scopeTitle: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '800',
  },
  scopeText: { color: colors.inkMuted, fontSize: 12, lineHeight: 18 },
});
