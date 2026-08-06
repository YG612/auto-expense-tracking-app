import { MaterialDesignIcons } from '@react-native-vector-icons/material-design-icons/static';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { parseTextTransactions } from '../../classification/parseTextTransactions';
import type { ParsedTransactionCandidate } from '../../classification/types';
import { useRepositories } from '../../app/DatabaseProvider';
import type {
  Account,
  Category,
  Merchant,
  UserRule,
} from '../../domain/entities';
import {
  buildTextTransaction,
  confirmationIssues,
  type TextTransactionReferenceData,
} from '../../domain/services/textTransaction';
import { createId } from '../../utils/createId';
import { useSpeechRecognition } from '../../speech/useSpeechRecognition';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../../theme/tokens';
import {
  ConfirmationCard,
  type CandidateSaveState,
} from './components/ConfirmationCard';
import { VoiceEntryPanel } from './components/VoiceEntryPanel';

type LoadedReferences = TextTransactionReferenceData & {
  userRules: readonly UserRule[];
  merchants: readonly Merchant[];
};

type CandidateView = {
  key: string;
  candidate: ParsedTransactionCandidate;
  inputSource: 'TEXT' | 'VOICE';
  saveState: CandidateSaveState;
  transactionId?: string;
};

const EXAMPLES = [
  '午饭花了25元，微信付的',
  '昨天晚上住酒店花了420，支付宝',
  '午饭25，打车18，水果32',
] as const;

function categoryLabel(
  candidate: ParsedTransactionCandidate,
  categories: readonly Category[],
): string {
  const category = categories.find(
    item =>
      item.id === candidate.categoryIdHint ||
      item.systemKey === candidate.categoryKey,
  );
  const subcategory = categories.find(
    item =>
      item.id === candidate.subcategoryIdHint ||
      item.systemKey === candidate.subcategoryKey,
  );
  if (category === undefined && subcategory === undefined) {
    return '待确认';
  }
  return subcategory === undefined
    ? (category?.name ?? '待确认')
    : `${category?.name ?? '分类'} / ${subcategory.name}`;
}

function accountLabel(
  candidateKey: ParsedTransactionCandidate['accountKey'],
  hint: string | undefined,
  accounts: readonly Account[],
): string {
  return (
    accounts.find(account => account.id === hint)?.name ??
    accounts.find(account => account.type === candidateKey)?.name ??
    '待补充'
  );
}

export function SmartEntryScreen() {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [input, setInput] = useState('');
  const [references, setReferences] = useState<LoadedReferences>();
  const [candidates, setCandidates] = useState<CandidateView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>();

  useFocusEffect(
    useCallback(() => {
      let active = true;
      setLoading(true);
      Promise.all([
        repositories.categories.listVisible(),
        repositories.accounts.listVisibleByUsage(),
        repositories.projects.listActive(),
        repositories.tags.listAll(),
        repositories.userRules.listEnabled(),
        repositories.merchants.listAll(),
      ])
        .then(
          ([categories, accounts, projects, tags, userRules, merchants]) => {
            if (active) {
              setReferences({
                categories,
                accounts,
                projects,
                tags,
                userRules,
                merchants,
              });
            }
          },
        )
        .catch(loadError => {
          if (active) {
            setError(
              loadError instanceof Error
                ? loadError.message
                : '读取本地识别资料失败。',
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

  const parseDescription = useCallback(
    (description: string, inputSource: 'TEXT' | 'VOICE') => {
      const trimmed = description.trim();
      if (trimmed.length === 0 || references === undefined) {
        setError(
          inputSource === 'VOICE'
            ? '语音转写为空，请重试或改用文字记账。'
            : '请先输入一段记账描述。',
        );
        return;
      }
      try {
        const result = parseTextTransactions(trimmed, {
          referenceDate: new Date(),
          recentAccountKey: references.accounts[0]?.type,
          categories: references.categories,
          accounts: references.accounts,
          userRules: references.userRules,
          merchants: references.merchants,
        });
        if (result.candidates.length === 0) {
          setCandidates([]);
          setError('暂时没有识别到交易，请补充金额或改用手动记账。');
          return;
        }
        setCandidates(
          result.candidates.map(candidate => ({
            key: createId('candidate'),
            candidate,
            inputSource,
            saveState: 'UNSAVED',
          })),
        );
        setError(undefined);
      } catch (parseError) {
        setError(
          parseError instanceof Error
            ? parseError.message
            : '记账描述解析失败。',
        );
      }
    },
    [references],
  );

  const [speechSnapshot, speechActions] = useSpeechRecognition(transcript => {
    setInput(transcript);
    parseDescription(transcript, 'VOICE');
  });

  const parse = () => parseDescription(input, 'TEXT');

  const setSaveState = (
    key: string,
    saveState: CandidateSaveState,
    transactionId?: string,
  ) =>
    setCandidates(current =>
      current.map(item =>
        item.key === key ? { ...item, saveState, transactionId } : item,
      ),
    );

  const persist = async (
    item: CandidateView,
    status: 'CONFIRMED' | 'PENDING',
    openEditor = false,
  ) => {
    if (references === undefined) {
      return;
    }
    const transactionId = item.transactionId ?? createId('transaction');
    setSaveState(item.key, 'SAVING', transactionId);
    setError(undefined);
    try {
      const built = buildTextTransaction(
        item.candidate,
        references,
        transactionId,
        new Date().toISOString(),
        status,
        item.inputSource,
      );
      if (status === 'CONFIRMED') {
        const issues = confirmationIssues(built.transaction);
        if (issues.length > 0) {
          throw new Error(`直接确认前请补充：${issues.join('、')}。`);
        }
      }
      await repositories.transactions.saveWithTags(
        built.transaction,
        built.tagIds,
      );
      setSaveState(item.key, status, transactionId);
      if (
        status === 'CONFIRMED' &&
        item.candidate.matchedRuleId !== undefined
      ) {
        repositories.userRules
          .recordUsage(item.candidate.matchedRuleId, new Date().toISOString())
          .catch(() => {
            setError('交易已确认，但规则使用统计暂时未能更新。');
          });
      }
      if (openEditor) {
        navigation.navigate('ManualEntry', { transactionId });
      }
    } catch (saveError) {
      setSaveState(item.key, 'UNSAVED');
      setError(
        saveError instanceof Error ? saveError.message : '保存失败，请重试。',
      );
    }
  };

  const canParse = input.trim().length > 0 && references !== undefined;
  const contentTitle = useMemo(
    () =>
      candidates.length === 0
        ? undefined
        : `识别到 ${candidates.length} 笔候选，请逐笔确认`,
    [candidates.length],
  );

  if (loading) {
    return (
      <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.centered}>
        <ActivityIndicator color={colors.brand} size="large" />
        <Text style={styles.muted}>正在加载本地识别规则…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <VoiceEntryPanel
          actions={speechActions}
          onUsePartial={text => {
            setInput(text);
            parseDescription(text, 'VOICE');
          }}
          snapshot={speechSnapshot}
        />

        <View style={styles.inputCard}>
          <View style={styles.inputHeader}>
            <View style={styles.inputTitleGroup}>
              <View style={styles.sectionIcon}>
                <MaterialDesignIcons
                  color={colors.income}
                  name="text-box-edit-outline"
                  size={21}
                />
              </View>
              <Text accessibilityRole="header" style={styles.title}>
                文字记账
              </Text>
              <Text style={styles.localBadge}>本地离线解析</Text>
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => navigation.navigate('Pending')}
              style={styles.pendingAction}
            >
              <MaterialDesignIcons
                color={colors.brand}
                name="inbox-arrow-down-outline"
                size={18}
              />
              <Text style={styles.pendingLink}>待确认箱</Text>
            </Pressable>
          </View>
          <Text style={styles.description}>
            用自然语言描述金额、用途、账户和时间；一句话可以包含多笔交易。
          </Text>
          <TextInput
            accessibilityLabel="文字记账描述"
            maxLength={500}
            multiline
            onChangeText={setInput}
            placeholder="例如：午饭花了25元，微信付的"
            placeholderTextColor={colors.placeholder}
            style={styles.input}
            textAlignVertical="top"
            value={input}
          />
          <ScrollView
            contentContainerStyle={styles.examples}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {EXAMPLES.map(example => (
              <Pressable
                accessibilityRole="button"
                key={example}
                onPress={() => setInput(example)}
                style={styles.example}
              >
                <Text
                  adjustsFontSizeToFit
                  maxFontSizeMultiplier={1.6}
                  minimumFontScale={0.75}
                  numberOfLines={1}
                  style={styles.exampleText}
                >
                  {example}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable
            accessibilityRole="button"
            disabled={!canParse}
            onPress={parse}
            style={[styles.parseButton, !canParse && styles.disabled]}
          >
            <View style={styles.buttonContent}>
              <MaterialDesignIcons
                color={colors.white}
                name="creation-outline"
                size={19}
              />
              <Text style={styles.parseButtonText}>解析并生成确认卡片</Text>
            </View>
          </Pressable>
          <Text style={styles.scopeNote}>
            文字分类始终在本机完成，不调用联网大模型。
          </Text>
        </View>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        {contentTitle === undefined ? null : (
          <Text style={styles.resultTitle}>{contentTitle}</Text>
        )}
        {candidates.map((item, index) => {
          const canPersist =
            item.candidate.amountMinor !== undefined &&
            item.candidate.type !== undefined &&
            item.candidate.occurredAt !== undefined;
          const canConfirm =
            canPersist &&
            item.candidate.missingFields.length === 0 &&
            item.candidate.confidenceLevel !== 'LOW';
          return (
            <ConfirmationCard
              accountLabel={accountLabel(
                item.candidate.accountKey,
                item.candidate.accountIdHint,
                references?.accounts ?? [],
              )}
              canConfirm={canConfirm}
              canPersist={canPersist}
              candidate={item.candidate}
              categoryLabel={categoryLabel(
                item.candidate,
                references?.categories ?? [],
              )}
              index={index}
              inputSource={item.inputSource}
              key={item.key}
              onConfirm={() => persist(item, 'CONFIRMED')}
              onEdit={() => {
                if (!canPersist) {
                  navigation.navigate('ManualEntry', undefined);
                  return;
                }
                persist(item, 'PENDING', true);
              }}
              onOpenPending={() => navigation.navigate('Pending')}
              onPending={() => persist(item, 'PENDING')}
              saveState={item.saveState}
              targetAccountLabel={accountLabel(
                item.candidate.targetAccountKey,
                undefined,
                references?.accounts ?? [],
              )}
            />
          );
        })}

        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('ManualEntry', undefined)}
          style={styles.manualLink}
        >
          <View style={styles.buttonContent}>
            <MaterialDesignIcons
              color={colors.inkMuted}
              name="pencil-outline"
              size={17}
            />
            <Text style={styles.manualLinkText}>
              无法准确描述？改用完整手动记账
            </Text>
          </View>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.canvas,
  },
  content: {
    gap: spacing.md,
    padding: spacing.md,
    paddingBottom: spacing.xxl,
  },
  inputCard: {
    gap: spacing.sm,
    borderRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    padding: spacing.lg,
    ...shadows.card,
  },
  inputHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    gap: 10,
  },
  inputTitleGroup: {
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  sectionIcon: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.incomeSoft,
  },
  title: { color: colors.ink, fontSize: 22, fontWeight: '800' },
  localBadge: {
    flexShrink: 1,
    borderRadius: radius.pill,
    backgroundColor: colors.incomeSoft,
    color: colors.income,
    fontSize: 10,
    fontWeight: '800',
    paddingHorizontal: 7,
    paddingVertical: 4,
  },
  pendingAction: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    paddingHorizontal: spacing.xxs,
  },
  pendingLink: { color: colors.brand, fontSize: 13, fontWeight: '800' },
  description: {
    color: colors.inkSecondary,
    fontSize: typography.body,
    lineHeight: 21,
  },
  input: {
    minHeight: 112,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    color: colors.ink,
    fontSize: 16,
    lineHeight: 24,
    padding: 13,
  },
  examples: { gap: 8, paddingRight: 12 },
  example: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    maxWidth: 210,
    borderRadius: radius.pill,
    backgroundColor: colors.brandSoft,
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  exampleText: { color: colors.brandPressed, fontSize: 11, fontWeight: '600' },
  parseButton: {
    alignItems: 'center',
    minHeight: 50,
    justifyContent: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.brand,
    paddingVertical: 14,
  },
  buttonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  parseButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
  disabled: { opacity: 0.5 },
  scopeNote: { color: colors.inkMuted, fontSize: 11, textAlign: 'center' },
  error: {
    borderRadius: 11,
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    padding: 12,
    lineHeight: 19,
  },
  resultTitle: { color: colors.ink, fontSize: 16, fontWeight: '800' },
  manualLink: {
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
  },
  manualLinkText: {
    color: colors.inkMuted,
    fontSize: 13,
    fontWeight: '700',
  },
  muted: { color: colors.inkMuted },
});
