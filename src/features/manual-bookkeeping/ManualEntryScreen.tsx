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
import { safeErrorMessage } from '../../domain/errors/AppError';
import type {
  Account,
  Category,
  Project,
  Tag,
  Transaction,
  TransactionType,
} from '../../domain/entities';
import {
  categorySelectionLabel,
  hasAdditionalManualInformation,
  primaryTransactionTypeOptions,
  quickTopLevelCategories,
  selectTopLevelCategory,
} from '../../domain/policies/bookkeepingPresentationPolicy';
import { cashFlowDirectionForTransactionType } from '../../domain/policies/simplifiedBookkeepingPolicy';
import {
  amountTextFromMinor,
  buildManualTransaction,
  getTransactionTypeOption,
  type ManualTransactionDraft,
  validateManualTransaction,
} from '../../domain/services/manualTransaction';
import { buildCorrectionLearningPlan } from '../../domain/services/personalizationLearning';
import { createId } from '../../utils/createId';
import {
  bookkeepingSession,
  type SessionCandidate,
} from '../smart-entry/BookkeepingSession';
import {
  persistEditedSessionCandidate,
  prepareSessionCandidateForEditing,
} from '../smart-entry/BookkeepingSessionPersistence';
import { DateTimeField } from './components/DateTimeField';
import {
  SelectionModal,
  type SelectionOption,
} from './components/SelectionModal';

type Props = StaticScreenProps<
  | {
      transactionId: string;
      sessionId?: never;
      candidateId?: never;
    }
  | {
      transactionId?: never;
      sessionId: string;
      candidateId: string;
    }
  | undefined
>;

type ModalName = 'category' | 'account' | 'targetAccount' | 'project' | 'tag';

const PRIMARY_TYPE_OPTIONS = primaryTransactionTypeOptions();

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
  return categories
    .filter(category => category.parentId === undefined)
    .map(category => ({
      id: category.id,
      label: category.name,
      icon: category.icon,
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
  const transactionId =
    route.params !== undefined && 'transactionId' in route.params
      ? route.params.transactionId
      : undefined;
  const sessionId =
    route.params !== undefined && 'sessionId' in route.params
      ? route.params.sessionId
      : undefined;
  const candidateId =
    route.params !== undefined && 'candidateId' in route.params
      ? route.params.candidateId
      : undefined;
  const [sessionCandidate] = useState<SessionCandidate | undefined>(() =>
    sessionId === undefined || candidateId === undefined
      ? undefined
      : bookkeepingSession.getCandidate(sessionId, candidateId),
  );
  const sessionSaveCompleted = useRef(false);
  const saveInFlight = useRef(false);
  const amountInput = useRef<TextInputType>(null);

  const [draft, setDraft] = useState<ManualTransactionDraft>(initialDraft);
  const [transactionTypeConfirmed, setTransactionTypeConfirmed] = useState(
    () =>
      sessionId === undefined || sessionCandidate?.candidate.type !== undefined,
  );
  const [existing, setExisting] = useState<Transaction | undefined>();
  const [categories, setCategories] = useState<Category[]>([]);
  const [referencedCategories, setReferencedCategories] = useState<Category[]>(
    [],
  );
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [activeModal, setActiveModal] = useState<ModalName | undefined>();
  const [showMoreInformation, setShowMoreInformation] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | undefined>();

  useEffect(
    () => () => {
      if (
        !sessionSaveCompleted.current &&
        sessionId !== undefined &&
        candidateId !== undefined
      ) {
        bookkeepingSession.cancelEdit(sessionId, candidateId);
      }
    },
    [candidateId, sessionId],
  );

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
        async ([
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
          const visibleCategoryIds = new Set(
            allCategories.map(category => category.id),
          );
          const referencedCategoryIds = Array.from(
            new Set(
              [transaction?.categoryId, transaction?.subcategoryId].filter(
                (id): id is string =>
                  id !== undefined && !visibleCategoryIds.has(id),
              ),
            ),
          );
          const hiddenReferences = (
            await Promise.all(
              referencedCategoryIds.map(id =>
                repositories.categories.findById(id),
              ),
            )
          ).filter((category): category is Category => category !== undefined);
          if (!active) {
            return;
          }

          setCategories(allCategories);
          setReferencedCategories(hiddenReferences);
          setAccounts(accountRows);
          setProjects(projectRows);
          setTags(tagRows);

          if (sessionId !== undefined && sessionCandidate === undefined) {
            setError('这条识别候选已处理或会话已失效，请返回重新识别。');
            return;
          }

          if (transactionId !== undefined && transaction === undefined) {
            setError('未找到这笔交易，可能已被删除。');
            return;
          }

          if (sessionCandidate !== undefined) {
            const prepared = prepareSessionCandidateForEditing(
              sessionCandidate,
              {
                categories: allCategories,
                accounts: accountRows,
                projects: projectRows,
                tags: tagRows,
              },
            );
            setDraft(prepared.draft);
            setShowMoreInformation(
              hasAdditionalManualInformation(prepared.draft),
            );
            if (prepared.draft.amountText.length === 0) {
              setTimeout(() => amountInput.current?.focus(), 50);
            }
          } else if (transaction !== undefined) {
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
            setShowMoreInformation(
              hasAdditionalManualInformation({
                merchantName: transaction.merchantRawName ?? '',
                projectId: transaction.projectId,
                tagIds: transactionTags.map(tag => tag.id),
                note: transaction.note ?? '',
              }),
            );
          } else {
            setDraft(current => ({
              ...current,
              accountId: accountRows[0]?.id,
            }));
            setTimeout(() => amountInput.current?.focus(), 50);
          }
        },
      )
      .catch(loadError => {
        if (active) {
          setError(
            safeErrorMessage(
              loadError,
              '加载账本失败。',
              'MANUAL-LOAD-UNEXPECTED',
            ),
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
  }, [repositories, sessionCandidate, sessionId, transactionId]);

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
  const quickCategories = useMemo(
    () =>
      transactionOption.categoryType === undefined
        ? []
        : quickTopLevelCategories(
            visibleCategories,
            transactionOption.categoryType,
          ),
    [transactionOption.categoryType, visibleCategories],
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
  const selectedCategoryId = draft.categoryId;
  const selectedDirection =
    cashFlowDirectionForTransactionType(draft.type) ??
    (draft.type === 'TRANSFER' ? 'EXPENSE' : undefined);

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
    setTransactionTypeConfirmed(true);
    setError(undefined);
  };

  const chooseCategory = (ids: string[]) => {
    const category = visibleCategories.find(item => item.id === ids[0]);
    setDraft(current => ({
      ...current,
      categoryId: category?.id,
      subcategoryId: undefined,
    }));
  };

  const chooseTopLevelCategory = (category: Category) => {
    setDraft(current => ({
      ...current,
      ...selectTopLevelCategory(category),
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
    if (saveInFlight.current) {
      return;
    }
    if (sessionId !== undefined && sessionCandidate === undefined) {
      setError('这条识别候选已处理或会话已失效，请返回重新识别。');
      return;
    }
    if (!transactionTypeConfirmed) {
      setError('这笔交易的收支性质无法可靠判断，请先明确选择交易类型。');
      return;
    }
    const validation = validateManualTransaction(draft);
    if (!validation.ok) {
      setError(validation.message);
      if (validation.field === 'amountText') {
        amountInput.current?.focus();
      }
      return;
    }

    saveInFlight.current = true;
    setSaving(true);
    setError(undefined);
    try {
      const now = new Date().toISOString();
      let promotedMerchant: string | undefined;

      if (sessionCandidate !== undefined) {
        if (sessionId === undefined || candidateId === undefined) {
          throw new Error('识别会话参数不完整，请返回重新识别。');
        }
        const persistence = await bookkeepingSession.persistEditedCandidate(
          sessionId,
          candidateId,
          async candidate => {
            const edited = await persistEditedSessionCandidate(
              candidate,
              draft,
              validation.amountMinor,
              { categories, accounts, projects, tags },
              repositories,
              now,
            );
            if (edited.learningResult?.promotionStatus === 'PROMOTED') {
              promotedMerchant =
                edited.learningPlan?.learnedMerchantRule?.pattern ?? '该商户';
            }
          },
        );
        if (persistence.status === 'FAILED') {
          setError(persistence.error);
          return;
        }
        if (persistence.status === 'IGNORED') {
          return;
        }
        sessionSaveCompleted.current = true;
      } else {
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
          await repositories.transactions.saveWithTags(
            transaction,
            draft.tagIds,
          );
        }
        if (learningResult?.promotionStatus === 'PROMOTED') {
          promotedMerchant =
            learningPlan?.learnedMerchantRule?.pattern ?? '该商户';
        }
      }

      const finish = () => {
        if (navigation.canGoBack()) {
          navigation.goBack();
        } else {
          navigation.navigate('Main');
        }
      };

      if (promotedMerchant !== undefined) {
        Alert.alert(
          '已学会这个商户',
          `你已连续 3 次把“${promotedMerchant}”纠正为相同分类。下次输入时会优先给出这个建议；可在“设置 → 分类规则”中查看、编辑或删除。`,
          [{ text: '知道了', onPress: finish }],
        );
        return;
      }

      finish();
    } catch (saveError) {
      setError(
        safeErrorMessage(
          saveError,
          '保存失败，请重试。',
          'MANUAL-SAVE-UNEXPECTED',
        ),
      );
    } finally {
      saveInFlight.current = false;
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
          <View style={styles.chipRow}>
            {PRIMARY_TYPE_OPTIONS.map(option => (
              <Pressable
                accessibilityRole="button"
                accessibilityState={{
                  selected:
                    transactionTypeConfirmed &&
                    selectedDirection === option.value,
                }}
                key={option.value}
                onPress={() => changeType(option.value)}
                style={[
                  styles.typeChip,
                  transactionTypeConfirmed &&
                    selectedDirection === option.value &&
                    styles.selectedChip,
                ]}
              >
                <Text
                  style={[
                    styles.typeChipText,
                    transactionTypeConfirmed &&
                      selectedDirection === option.value &&
                      styles.selectedChipText,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            ))}
          </View>
          {transactionTypeConfirmed ? null : (
            <Text accessibilityRole="alert" style={styles.typeChoiceHint}>
              识别结果没有擅自按支出处理，请明确选择正确的交易类型。
            </Text>
          )}
        </Field>

        <Field label="金额（元）" required>
          <View style={styles.amountRow}>
            <Text style={styles.currency}>¥</Text>
            <TextInput
              ref={amountInput}
              accessibilityLabel="金额"
              autoFocus={
                transactionId === undefined &&
                sessionId === undefined &&
                sessionCandidate === undefined
              }
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
              {quickCategories.map(category => (
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{
                    selected: draft.categoryId === category.id,
                  }}
                  key={category.id}
                  onPress={() => chooseTopLevelCategory(category)}
                  style={[
                    styles.quickChip,
                    draft.categoryId === category.id && styles.selectedChip,
                  ]}
                >
                  <Text style={styles.quickIcon}>{category.icon ?? '•'}</Text>
                  <Text
                    style={[
                      styles.quickText,
                      draft.categoryId === category.id &&
                        styles.selectedChipText,
                    ]}
                  >
                    {category.name}
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
                {categorySelectionLabel(
                  [...visibleCategories, ...referencedCategories],
                  draft.categoryId,
                  undefined,
                  '选择分类',
                )}
              </Text>
              <Text style={styles.chevron}>›</Text>
            </Pressable>
            {referencedCategories.some(
              category =>
                category.id === draft.categoryId ||
                category.id === draft.subcategoryId,
            ) ? (
              <Text style={styles.hiddenCategoryHint}>
                当前旧账使用了已隐藏分类；可以保留，也可以重新选择。
              </Text>
            ) : null}
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

        <Pressable
          accessibilityRole="button"
          accessibilityState={{ expanded: showMoreInformation }}
          onPress={() => setShowMoreInformation(value => !value)}
          style={styles.moreInformationToggle}
        >
          <View style={styles.moreInformationCopy}>
            <Text style={styles.moreInformationTitle}>
              {showMoreInformation ? '收起更多信息' : '更多信息'}
            </Text>
            <Text style={styles.moreInformationHint}>
              商户、项目、标签和备注
            </Text>
          </View>
          <Text style={styles.moreInformationChevron}>
            {showMoreInformation ? '⌃' : '⌄'}
          </Text>
        </Pressable>

        {showMoreInformation ? (
          <>
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
                  {selectedName(
                    projectOptions,
                    draft.projectId,
                    '选择或新建项目',
                  )}
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
                onChangeText={note =>
                  setDraft(current => ({ ...current, note }))
                }
                placeholder="可选"
                placeholderTextColor="#94A3B8"
                style={[styles.textInput, styles.noteInput]}
                textAlignVertical="top"
                value={draft.note}
              />
            </Field>
          </>
        ) : null}

        {error === undefined ? null : (
          <Text accessibilityRole="alert" style={styles.error}>
            {error}
          </Text>
        )}

        <Pressable
          accessibilityRole="button"
          disabled={
            saving ||
            (sessionId !== undefined && sessionCandidate === undefined)
          }
          onPress={save}
          style={[
            styles.saveButton,
            (saving ||
              (sessionId !== undefined && sessionCandidate === undefined)) &&
              styles.disabledButton,
          ]}
        >
          {saving ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.saveText}>
            {sessionId !== undefined
              ? '保存并确认'
              : existing === undefined
                ? '保存这笔账'
                : '保存修改'}
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
  typeChoiceHint: {
    borderRadius: 10,
    backgroundColor: '#FFF7ED',
    color: '#9A3412',
    fontSize: 13,
    lineHeight: 19,
    padding: 10,
  },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  typeChip: {
    minHeight: 48,
    minWidth: 96,
    flexGrow: 1,
    flexBasis: '45%',
    alignItems: 'center',
    justifyContent: 'center',
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
    minHeight: 52,
    minWidth: 96,
    flexGrow: 1,
    flexBasis: '30%',
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
  quickText: {
    flexShrink: 1,
    color: '#334155',
    fontSize: 13,
    fontWeight: '600',
  },
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
  hiddenCategoryHint: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 19,
  },
  chevron: { color: '#94A3B8', fontSize: 28 },
  cardField: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
  },
  moreInformationToggle: {
    minHeight: 54,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    borderRadius: 12,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  moreInformationCopy: { flex: 1, gap: 2 },
  moreInformationTitle: {
    color: '#0F172A',
    fontSize: 15,
    fontWeight: '700',
  },
  moreInformationHint: { color: '#64748B', fontSize: 13 },
  moreInformationChevron: { color: '#64748B', fontSize: 22 },
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
