import type { StaticScreenProps } from '@react-navigation/native';
import { useNavigation } from '@react-navigation/native';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  type TextInput as TextInputType,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../../app/DatabaseProvider';
import type {
  Account,
  Category,
  Project,
  Tag,
  Transaction,
  TransactionType,
} from '../../domain/entities';
import {
  amountTextFromMinor,
  buildManualTransaction,
  getTransactionTypeOption,
  TRANSACTION_TYPE_OPTIONS,
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../domain/services/manualTransaction';
import { buildCorrectionLearningPlan } from '../../domain/services/personalizationLearning';
import { createId } from '../../utils/createId';
import { DateTimeField } from './components/DateTimeField';
import {
  SelectionModal,
  type SelectionOption,
} from './components/SelectionModal';

type Props = StaticScreenProps<
  | {
      transactionId?: string;
    }
  | undefined
>;

type ModalName = 'category' | 'account' | 'targetAccount' | 'project' | 'tag';

const initialDraft = (): ManualTransactionDraft => ({
  type: 'EXPENSE',
  amountText: '',
  occurredAt: new Date(),
  merchantName: '',
  tagIds: [],
  note: '',
});

function Field({
  label,
  required = false,
  children,
}: {
  label: string;
  required?: boolean;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.fieldLabel}>
        {label}
        {required ? <Text style={styles.required}> *</Text> : null}
      </Text>
      {children}
    </View>
  );
}

function categoryOptions(categories: readonly Category[]): SelectionOption[] {
  const categoryById = new Map(
    categories.map(category => [category.id, category]),
  );
  const parentIds = new Set(
    categories.flatMap(category =>
      category.parentId === undefined ? [] : [category.parentId],
    ),
  );

  return categories
    .filter(
      category =>
        category.parentId !== undefined || !parentIds.has(category.id),
    )
    .map(category => ({
      id: category.id,
      label: category.name,
      detail:
        category.parentId === undefined
          ? undefined
          : categoryById.get(category.parentId)?.name,
      icon:
        category.icon ??
        (category.parentId === undefined
          ? undefined
          : categoryById.get(category.parentId)?.icon),
    }));
}

function selectedName(
  options: readonly SelectionOption[],
  selectedId: string | undefined,
  fallback: string,
): string {
  if (selectedId === undefined) {
    return fallback;
  }

  const option = options.find(item => item.id === selectedId);
  return option === undefined
    ? fallback
    : option.detail === undefined
      ? option.label
      : `${option.detail} / ${option.label}`;
}

export function ManualEntryScreen({ route }: Props) {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const transactionId = route.params?.transactionId;
  const amountInput = useRef<TextInputType>(null);

  const [draft, setDraft] = useState<ManualTransactionDraft>(initialDraft);
  const [existing, setExisting] = useState<Transaction | undefined>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeModal, setActiveModal] = useState<ModalName | undefined>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(() => {
    let active = true;

    Promise.all([
      repositories.categories.listVisibleByUsage('EXPENSE'),
      repositories.categories.listVisibleByUsage('INCOME'),
      repositories.accounts.listVisibleByUsage(),
      repositories.projects.listActive(),
      repositories.tags.listAll(),
      transactionId === undefined
        ? Promise.resolve(undefined)
        : repositories.transactions.findById(transactionId),
      transactionId === undefined
        ? Promise.resolve([])
        : repositories.transactionTags.listForTransaction(transactionId),
    ])
      .then(
        ([
          expense,
          income,
          accountRows,
          projectRows,
          tagRows,
          transaction,
          transactionTags,
        ]) => {
          if (!active) {
            return;
          }

          const allCategories = [...expense, ...income];
          setCategories(allCategories);
          setAccounts(accountRows);
          setProjects(projectRows);
          setTags(tagRows);

          if (transactionId !== undefined && transaction === undefined) {
            setError('未找到这笔交易，可能已被删除。');
            return;
          }

          if (transaction !== undefined) {
            setExisting(transaction);
            setDraft({
              type: transaction.type,
              amountText: amountTextFromMinor(transaction.amountMinor),
              occurredAt: new Date(transaction.occurredAt),
              categoryId: transaction.categoryId,
              subcategoryId: transaction.subcategoryId,
              accountId: transaction.accountId,
              targetAccountId: transaction.targetAccountId,
              merchantName: transaction.merchantRawName ?? '',
              projectId: transaction.projectId,
              tagIds: transactionTags.map(tag => tag.id),
              note: transaction.note ?? '',
            });
          } else {
            const expenseOptions = categoryOptions(expense);
            const firstCategory = expense.find(
              category => category.id === expenseOptions[0]?.id,
            );
            setDraft(current => ({
              ...current,
              accountId: accountRows[0]?.id,
              categoryId: firstCategory?.parentId ?? firstCategory?.id,
              subcategoryId:
                firstCategory?.parentId === undefined
                  ? undefined
                  : firstCategory.id,
            }));
            setTimeout(() => amountInput.current?.focus(), 50);
          }
        },
      )
      .catch(loadError => {
        if (active) {
          setError(
            loadError instanceof Error ? loadError.message : '加载账本失败。',
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
  }, [repositories, transactionId]);

  const transactionOption = getTransactionTypeOption(draft.type);
  const visibleCategories = useMemo(
    () =>
      transactionOption.categoryType === undefined
        ? []
        : categories.filter(
            category => category.type === transactionOption.categoryType,
          ),
    [categories, transactionOption.categoryType],
  );
  const availableCategoryOptions = useMemo(
    () => categoryOptions(visibleCategories),
    [visibleCategories],
  );
  const accountOptions = useMemo(
    () =>
      accounts.map(account => ({
        id: account.id,
        label: account.name,
        icon: account.icon,
      })),
    [accounts],
  );
  const projectOptions = useMemo(
    () => projects.map(project => ({ id: project.id, label: project.name })),
    [projects],
  );
  const tagOptions = useMemo(
    () => tags.map(tag => ({ id: tag.id, label: tag.name })),
    [tags],
  );
  const selectedCategoryId = draft.subcategoryId ?? draft.categoryId;

  const changeType = (type: TransactionType) => {
    const previousCategoryType = getTransactionTypeOption(
      draft.type,
    ).categoryType;
    const nextOption = getTransactionTypeOption(type);

    setDraft(current => ({
      ...current,
      type,
      categoryId:
        previousCategoryType === nextOption.categoryType
          ? current.categoryId
          : undefined,
      subcategoryId:
        previousCategoryType === nextOption.categoryType
          ? current.subcategoryId
          : undefined,
      targetAccountId: nextOption.requiresTargetAccount
        ? current.targetAccountId
        : undefined,
    }));
    setError(undefined);
  };

  const chooseCategory = (ids: string[]) => {
    const category = visibleCategories.find(item => item.id === ids[0]);
    setDraft(current => ({
      ...current,
      categoryId: category?.parentId ?? category?.id,
      subcategoryId: category?.parentId === undefined ? undefined : category.id,
    }));
  };

  const createProject = async (name: string): Promise<string> => {
    const trimmed = name.trim();
    const found = await repositories.projects.findByName(trimmed);
    if (found !== undefined) {
      return found.id;
    }

    const now = new Date().toISOString();
    const project: Project = {
      id: createId('project'),
      name: trimmed,
      currency: 'CNY',
      isArchived: false,
      createdAt: now,
      updatedAt: now,
    };
    await repositories.projects.create(project);
    setProjects(current => [project, ...current]);
    return project.id;
  };

  const createTag = async (name: string): Promise<string> => {
    const trimmed = name.trim();
    const found = await repositories.tags.findByName(trimmed);
    if (found !== undefined) {
      return found.id;
    }

    const now = new Date().toISOString();
    const tag: Tag = {
      id: createId('tag'),
      name: trimmed,
      createdAt: now,
      updatedAt: now,
    };
    await repositories.tags.create(tag);
    setTags(current =>
      [...current, tag].sort((left, right) =>
        left.name.localeCompare(right.name, 'zh-CN'),
      ),
    );
    return tag.id;
  };

  const save = async () => {
    const validation = validateManualTransaction(draft);
    if (!validation.ok) {
      setError(validation.message);
      if (validation.field === 'amountText') {
        amountInput.current?.focus();
      }
      return;
    }

    setSaving(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      const transaction = buildManualTransaction(
        draft,
        validation.amountMinor,
        existing?.id ?? createId('transaction'),
        now,
        existing,
      );
      const learningPlan =
        existing === undefined
          ? undefined
          : buildCorrectionLearningPlan(
              existing,
              transaction,
              now,
              createId('feedback'),
              createId('rule'),
            );
      const learningResult =
        learningPlan === undefined
          ? undefined
          : await repositories.classificationFeedback.saveCorrectedTransactionWithTags(
              {
                transaction,
                tagIds: draft.tagIds,
                feedback: learningPlan.feedback,
                correctionOptions: {
                  learnedMerchantRule: learningPlan.learnedMerchantRule,
                  processedAt: now,
                },
              },
            );

      if (learningPlan === undefined) {
        await repositories.transactions.saveWithTags(transaction, draft.tagIds);
      }

      const finish = () => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('Main');
        }
      };

      if (learningResult?.promotionStatus === 'PROMOTED') {
        Alert.alert(
          '已学会这个商户',
          `你已连续 3 次把“${learningPlan?.learnedMerchantRule?.pattern ?? '该商户'}”纠正为相同分类。下次输入时会优先给出这个建议；可在“设置 → 分类规则”中查看、编辑或删除。`,
          [{ text: '知道了', onPress: finish }],
        );
        return;
      }

      finish();
    } catch (saveError) {
      setError(
        saveError instanceof Error ? saveError.message : '保存失败，请重试。',
      );
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <SafeAreaView edges={['bottom']} style={styles.loading}>
        <ActivityIndicator color="#2563EB" size="large" />
        <Text style={styles.muted}>正在读取本地账本…</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView edges={['bottom']} style={styles.safeArea}>
      <ScrollView
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Field label="交易类型" required>
          <ScrollView
            contentContainerStyle={styles.chipRow}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {TRANSACTION_TYPE_OPTIONS.map(option => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ selected: draft.type === option.value }}
                key={option.value}
                onPress={() => changeType(option.value)}
                style={[
                  styles.typeChip,
                  draft.type === option.value && styles.selectedChip,
                ]}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    draft.type === option.value && styles.selectedChipText,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </ScrollView>
        </Field>

        <Field label="金额（元）" required>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>¥</Text>
            <TextInput
              ref={amountInput}
              accessibilityLabel="金额"
              autoFocus={transactionId === undefined}
              keyboardType="decimal-pad"
              maxLength={14}
              onChangeText={amountText =>
                setDraft(current => ({ ...current, amountText }))
              }
              placeholder="0.00"
              placeholderTextColor="#94A3B8"
              selectTextOnFocus
              style={styles.amountInput}
              value={draft.amountText}
            />
          </View>
        </Field>

        {transactionOption.categoryType === undefined ? null : (
          <Field label="分类" required>
            <View style={styles.quickChoices}>
              {availableCategoryOptions.slice(0, 6).map(option => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: selectedCategoryId === option.id,
                  }}
                  key={option.id}
                  onPress={() => chooseCategory([option.id])}
                  style={[
                    styles.quickChip,
                    selectedCategoryId === option.id && styles.selectedChip,
                  ]}
                >
                  <Text style={styles.quickIcon}>{option.icon ?? '•'}</Text>
                  <Text
                    numberOfLines={1}
                    style={[
                      styles.quickText,
                      selectedCategoryId === option.id &&
                        styles.selectedChipText,
                    ]}
                  >
                    {option.label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveModal('category')}
              style={styles.selector}
            >
              <Text style={styles.selectorValue}>
                {selectedName(
                  availableCategoryOptions,
                  selectedCategoryId,
                  '选择分类',
                )}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Field>
        )}

        <Field
          label={transactionOption.requiresTargetAccount ? '转出账户' : '账户'}
          required
        >
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveModal('account')}
            style={styles.selector}
          >
            <Text style={styles.selectorValue}>
              {selectedName(accountOptions, draft.accountId, '选择账户')}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Field>

        {transactionOption.requiresTargetAccount ? (
          <Field label="转入账户" required>
            <Pressable
              accessibilityRole="button"
              onPress={() => setActiveModal('targetAccount')}
              style={styles.selector}
            >
              <Text style={styles.selectorValue}>
                {selectedName(
                  accountOptions,
                  draft.targetAccountId,
                  '选择转入账户',
                )}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
          </Field>
        ) : null}

        <Field label="日期和时间" required>
          <View style={styles.cardField}>
            <DateTimeField
              onChange={occurredAt =>
                setDraft(current => ({ ...current, occurredAt }))
              }
              value={draft.occurredAt}
            />
          </View>
        </Field>

        <Field label="商户">
          <TextInput
            accessibilityLabel="商户"
            maxLength={80}
            onChangeText={merchantName =>
              setDraft(current => ({ ...current, merchantName }))
            }
            placeholder="例如：便利店、咖啡店"
            placeholderTextColor="#94A3B8"
            style={styles.textInput}
            value={draft.merchantName}
          />
        </Field>

        <Field label="项目">
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveModal('project')}
            style={styles.selector}
          >
            <Text style={styles.selectorValue}>
              {selectedName(projectOptions, draft.projectId, '选择或新建项目')}
            </Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Field>

        <Field label="标签">
          {draft.tagIds.length === 0 ? null : (
            <View style={styles.selectedTags}>
              {draft.tagIds.map(tagId => (
                <Pressable
                  accessibilityRole="button"
                  key={tagId}
                  onPress={() =>
                    setDraft(current => ({
                      ...current,
                      tagIds: current.tagIds.filter(id => id !== tagId),
                    }))
                  }
                  style={styles.tag}
                >
                  <Text style={styles.tagText}>
                    {tags.find(tag => tag.id === tagId)?.name ?? tagId} ×
                  </Text>
                </Pressable>
              ))}
            </View>
          )}
          <Pressable
            accessibilityRole="button"
            onPress={() => setActiveModal('tag')}
            style={styles.selector}
          >
            <Text style={styles.selectorValue}>选择或新建标签</Text>
            <Text style={styles.chevron}>›</Text>
          </Pressable>
        </Field>

        <Field label="备注">
          <TextInput
            accessibilityLabel="备注"
            maxLength={500}
            multiline
            onChangeText={note => setDraft(current => ({ ...current, note }))}
            placeholder="可选"
            placeholderTextColor="#94A3B8"
            style={[styles.textInput, styles.noteInput]}
            textAlignVertical="top"
            value={draft.note}
          />
        </Field>

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={saving}
          onPress={save}
          style={[styles.saveButton, saving && styles.disabledButton]}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.saveText}>
            {existing === undefined ? '保存这笔账' : '保存修改'}
          </Text>
        </Pressable>
      </ScrollView>

      <SelectionModal
        onChange={chooseCategory}
        onClose={() => setActiveModal(undefined)}
        options={availableCategoryOptions}
        selectedIds={
          selectedCategoryId === undefined ? [] : [selectedCategoryId]
        }
        title="分类"
        visible={activeModal === 'category'}
      />
      <SelectionModal
        onChange={ids =>
          setDraft(current => ({ ...current, accountId: ids[0] }))
        }
        onClose={() => setActiveModal(undefined)}
        options={accountOptions}
        selectedIds={draft.accountId === undefined ? [] : [draft.accountId]}
        title="账户"
        visible={activeModal === 'account'}
      />
      <SelectionModal
        onChange={ids =>
          setDraft(current => ({ ...current, targetAccountId: ids[0] }))
        }
        onClose={() => setActiveModal(undefined)}
        options={accountOptions.filter(option => option.id !== draft.accountId)}
        selectedIds={
          draft.targetAccountId === undefined ? [] : [draft.targetAccountId]
        }
        title="转入账户"
        visible={activeModal === 'targetAccount'}
      />
      <SelectionModal
        allowClear
        createLabel="新建项目"
        onChange={ids =>
          setDraft(current => ({ ...current, projectId: ids[0] }))
        }
        onClose={() => setActiveModal(undefined)}
        onCreate={createProject}
        options={projectOptions}
        selectedIds={draft.projectId === undefined ? [] : [draft.projectId]}
        title="项目"
        visible={activeModal === 'project'}
      />
      <SelectionModal
        createLabel="新建标签"
        multiple
        onChange={tagIds => setDraft(current => ({ ...current, tagIds }))}
        onClose={() => setActiveModal(undefined)}
        onCreate={createTag}
        options={tagOptions}
        selectedIds={draft.tagIds}
        title="标签"
        visible={activeModal === 'tag'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F8FAFC' },
  loading: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#F8FAFC',
  },
  muted: { color: '#64748B' },
  content: { gap: 18, padding: 16, paddingBottom: 40 },
  field: { gap: 9 },
  fieldLabel: { color: '#334155', fontSize: 14, fontWeight: '700' },
  required: { color: '#DC2626' },
  chipRow: { gap: 8, paddingRight: 16 },
  typeChip: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  selectedChip: { borderColor: '#2563EB', backgroundColor: '#2563EB' },
  typeChipText: { color: '#475569', fontWeight: '600' },
  selectedChipText: { color: '#FFFFFF' },
  amountRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#93C5FD',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
  },
  currency: { color: '#2563EB', fontSize: 28, fontWeight: '700' },
  amountInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 36,
    fontWeight: '700',
    paddingHorizontal: 12,
    paddingVertical: 12,
  },
  quickChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quickChip: {
    width: '30%',
    minWidth: 88,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 10,
    paddingVertical: 9,
  },
  quickIcon: { fontSize: 16 },
  quickText: { flex: 1, color: '#334155', fontSize: 13, fontWeight: '600' },
  selector: {
    minHeight: 50,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
  },
  selectorValue: { flex: 1, color: '#0F172A', fontSize: 15 },
  chevron: { color: '#94A3B8', fontSize: 28 },
  cardField: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  textInput: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    color: '#0F172A',
    fontSize: 15,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  noteInput: { minHeight: 96 },
  selectedTags: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  tag: {
    borderRadius: 999,
    backgroundColor: '#E0E7FF',
    paddingHorizontal: 11,
    paddingVertical: 7,
  },
  tagText: { color: '#3730A3', fontWeight: '600' },
  error: {
    borderRadius: 10,
    backgroundColor: '#FEE2E2',
    color: '#991B1B',
    padding: 12,
    lineHeight: 20,
  },
  saveButton: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 9,
    borderRadius: 16,
    backgroundColor: '#2563EB',
    padding: 14,
  },
  disabledButton: { opacity: 0.65 },
  saveText: { color: '#FFFFFF', fontSize: 17, fontWeight: '800' },
});
