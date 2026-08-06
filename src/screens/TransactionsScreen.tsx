import {
  type StaticScreenProps,
  useFocusEffect,
  useNavigation,
} from '@react-navigation/native';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Pressable,
  ScrollView,
  SectionList,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useRepositories } from '../app/DatabaseProvider';
import type {
  Account,
  Category,
  Project,
  Tag,
  TransactionType,
} from '../domain/entities';
import {
  formatAmountMinor,
  TRANSACTION_TYPE_OPTIONS,
} from '../domain/services/manualTransaction';
import type { TransactionSummary } from '../database';
import {
  SelectionModal,
  type SelectionOption,
} from '../features/manual-bookkeeping/components/SelectionModal';
import {
  transactionAmountTone,
  transactionCategoryLabel,
  transactionTitle,
} from '../features/transactions/transactionPresentation';
import {
  colors,
  control,
  radius,
  shadows,
  spacing,
  typography,
} from '../theme/tokens';

type LedgerMode = 'active' | 'recycle';
type FilterModal = 'category' | 'account' | 'project' | 'tag';

export type TransactionsScreenParams = {
  monthStart?: string;
  categoryId?: string;
  requestKey?: string;
};

type LedgerFilters = {
  type?: TransactionType;
  categoryId?: string;
  accountId?: string;
  projectId?: string;
  tagId?: string;
};

type LedgerSection = {
  title: string;
  data: TransactionSummary[];
};

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function changeMonth(date: Date, offset: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + offset, 1);
}

function monthLabel(date: Date): string {
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
  }).format(date);
}

function dayLabel(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'long',
    day: 'numeric',
    weekday: 'short',
  }).format(new Date(iso));
}

function timeLabel(iso: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(iso));
}

function groupByDay(
  transactions: readonly TransactionSummary[],
): LedgerSection[] {
  const groups = new Map<string, TransactionSummary[]>();

  for (const transaction of transactions) {
    const date = new Date(transaction.occurredAt);
    const key = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }

  return [...groups.values()].map(group => ({
    title: dayLabel(group[0]!.occurredAt),
    data: group,
  }));
}

function categorySelectionOptions(
  categories: readonly Category[],
): SelectionOption[] {
  const byId = new Map(categories.map(category => [category.id, category]));
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
          ? category.type === 'INCOME'
            ? '收入'
            : undefined
          : byId.get(category.parentId)?.name,
      icon: category.icon ?? byId.get(category.parentId ?? '')?.icon,
    }));
}

function optionLabel(
  options: readonly SelectionOption[],
  id: string | undefined,
  fallback: string,
): string {
  const option = options.find(item => item.id === id);
  return option === undefined ? fallback : option.label;
}

function TransactionRow({
  transaction,
  mode,
  onEdit,
  onDelete,
  onRestore,
}: {
  transaction: TransactionSummary;
  mode: LedgerMode;
  onEdit: () => void;
  onDelete: () => void;
  onRestore: () => void;
}) {
  const tone = transactionAmountTone(transaction.type);
  const accountText =
    transaction.targetAccountName === undefined
      ? transaction.accountName
      : `${transaction.accountName ?? '未指定'} → ${transaction.targetAccountName}`;

  return (
    <View style={styles.transactionCard}>
      <Pressable
        accessibilityLabel={
          mode === 'active'
            ? `编辑${transactionTitle(transaction)}，${formatAmountMinor(transaction.amountMinor)}`
            : undefined
        }
        accessibilityRole={mode === 'active' ? 'button' : undefined}
        accessible={mode === 'active'}
        disabled={mode === 'recycle'}
        onPress={onEdit}
        style={styles.transactionContent}
      >
        <View style={styles.transactionTop}>
          <View style={styles.transactionIcon}>
            <Text style={styles.transactionIconText}>
              {transactionCategoryLabel(transaction).slice(0, 1)}
            </Text>
          </View>
          <View style={styles.transactionMain}>
            <View style={styles.titleLine}>
              <Text numberOfLines={1} style={styles.transactionTitle}>
                {transactionTitle(transaction)}
              </Text>
              {transaction.duplicateStatus === 'POSSIBLE' ? (
                <Text style={styles.duplicateBadge}>疑似重复</Text>
              ) : null}
            </View>
            <Text style={styles.transactionCategory}>
              {transactionCategoryLabel(transaction)} ·{' '}
              {timeLabel(transaction.occurredAt)}
            </Text>
          </View>
          <Text
            style={[
              styles.amount,
              tone === 'negative' && styles.negativeAmount,
              tone === 'positive' && styles.positiveAmount,
            ]}
          >
            {tone === 'negative' ? '−' : tone === 'positive' ? '+' : ''}
            {formatAmountMinor(transaction.amountMinor)}
          </Text>
        </View>
        {accountText === undefined &&
        transaction.projectName === undefined ? null : (
          <Text style={styles.meta}>
            {[accountText, transaction.projectName]
              .filter(value => value !== undefined)
              .join(' · ')}
          </Text>
        )}
        {transaction.tagNames.length === 0 ? null : (
          <Text style={styles.tags}>#{transaction.tagNames.join('  #')}</Text>
        )}
      </Pressable>
      <View style={styles.rowActions}>
        {mode === 'active' ? (
          <>
            <Pressable
              accessibilityRole="button"
              onPress={onEdit}
              style={styles.rowActionButton}
            >
              <Text style={styles.editAction}>编辑</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              onPress={onDelete}
              style={styles.rowActionButton}
            >
              <Text style={styles.deleteAction}>删除</Text>
            </Pressable>
          </>
        ) : (
          <Pressable
            accessibilityRole="button"
            onPress={onRestore}
            style={styles.rowActionButton}
          >
            <Text style={styles.restoreAction}>恢复</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

function requestedMonth(monthStart: string | undefined): Date | undefined {
  if (monthStart === undefined) {
    return undefined;
  }

  const parsed = new Date(monthStart);
  return Number.isNaN(parsed.getTime()) ? undefined : startOfMonth(parsed);
}

export function TransactionsScreen({
  route,
}: StaticScreenProps<TransactionsScreenParams>) {
  const navigation = useNavigation();
  const repositories = useRepositories();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [mode, setMode] = useState<LedgerMode>('active');
  const [query, setQuery] = useState('');
  const [filters, setFilters] = useState<LedgerFilters>({});
  const [showFilters, setShowFilters] = useState(false);
  const [filterModal, setFilterModal] = useState<FilterModal | undefined>();
  const [transactions, setTransactions] = useState<TransactionSummary[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [projects, setProjects] = useState<Project[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | undefined>();
  const [reloadToken, setReloadToken] = useState(0);
  const latestReloadToken = useRef(reloadToken);
  latestReloadToken.current = reloadToken;

  useEffect(() => {
    if (route.params?.requestKey === undefined) {
      return;
    }

    const nextMonth = requestedMonth(route.params.monthStart);
    if (nextMonth !== undefined) {
      setMonth(nextMonth);
    }
    setMode('active');
    setQuery('');
    setShowFilters(false);
    setFilters({ categoryId: route.params?.categoryId });
  }, [
    route.params?.categoryId,
    route.params?.monthStart,
    route.params?.requestKey,
  ]);

  const monthEnd = useMemo(() => changeMonth(month, 1), [month]);

  useFocusEffect(
    useCallback(() => {
      const requestReloadToken = reloadToken;
      let active = true;
      const isLatestRequest = () =>
        active && requestReloadToken === latestReloadToken.current;
      const timer = setTimeout(() => {
        setLoading(true);
        setError(undefined);
        Promise.all([
          repositories.transactions.listSummaries({
            deletedOnly: mode === 'recycle',
            confirmationStatus: mode === 'active' ? 'CONFIRMED' : undefined,
            occurredFrom: month.toISOString(),
            occurredBefore: monthEnd.toISOString(),
            query,
            ...filters,
          }),
          repositories.categories.listVisible(),
          repositories.accounts.listVisible(),
          repositories.projects.listActive(),
          repositories.tags.listAll(),
        ])
          .then(([rows, categoryRows, accountRows, projectRows, tagRows]) => {
            if (isLatestRequest()) {
              setTransactions(rows);
              setCategories(categoryRows);
              setAccounts(accountRows);
              setProjects(projectRows);
              setTags(tagRows);
            }
          })
          .catch(loadError => {
            if (isLatestRequest()) {
              setError(
                loadError instanceof Error
                  ? loadError.message
                  : '读取流水失败。',
              );
            }
          })
          .finally(() => {
            if (isLatestRequest()) {
              setLoading(false);
            }
          });
      }, 180);

      return () => {
        active = false;
        clearTimeout(timer);
      };
    }, [filters, mode, month, monthEnd, query, reloadToken, repositories]),
  );

  const sections = useMemo(() => groupByDay(transactions), [transactions]);
  const categoryOptions = useMemo(
    () => categorySelectionOptions(categories),
    [categories],
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

  const edit = (transactionId: string) =>
    navigation.navigate('ManualEntry', { transactionId });

  const softDelete = (transaction: TransactionSummary) => {
    Alert.alert(
      '移入回收站？',
      `“${transactionTitle(transaction)}”将不再计入流水和统计，可稍后恢复。`,
      [
        { text: '取消', style: 'cancel' },
        {
          text: '移入回收站',
          style: 'destructive',
          onPress: async () => {
            try {
              const deleted = await repositories.transactions.softDelete(
                transaction.id,
                new Date().toISOString(),
              );
              if (!deleted) {
                throw new Error('交易已被修改，请刷新后重试。');
              }
              setReloadToken(value => value + 1);
            } catch (deleteError) {
              Alert.alert(
                '删除失败',
                deleteError instanceof Error
                  ? deleteError.message
                  : '暂时无法将交易移入回收站。',
              );
            }
          },
        },
      ],
    );
  };

  const restore = async (transactionId: string) => {
    try {
      const restored = await repositories.transactions.restore(
        transactionId,
        new Date().toISOString(),
      );
      if (!restored) {
        throw new Error('交易已被修改，请刷新后重试。');
      }
      setReloadToken(value => value + 1);
    } catch (restoreError) {
      Alert.alert(
        '恢复失败',
        restoreError instanceof Error
          ? restoreError.message
          : '暂时无法恢复这笔交易。',
      );
    }
  };

  const setSingleFilter = (
    key: 'categoryId' | 'accountId' | 'projectId' | 'tagId',
    ids: string[],
  ) => setFilters(current => ({ ...current, [key]: ids[0] }));

  return (
    <SafeAreaView edges={['left', 'right', 'bottom']} style={styles.safeArea}>
      <View style={styles.toolbar}>
        <View style={styles.segmented}>
          {(['active', 'recycle'] as const).map(value => (
            <Pressable
              accessibilityRole="button"
              accessibilityState={{ selected: mode === value }}
              key={value}
              onPress={() => setMode(value)}
              style={[styles.segment, mode === value && styles.selectedSegment]}
            >
              <Text
                style={[
                  styles.segmentText,
                  mode === value && styles.selectedSegmentText,
                ]}
              >
                {value === 'active' ? '流水' : '回收站'}
              </Text>
            </Pressable>
          ))}
        </View>
        <View style={styles.monthRow}>
          <Pressable
            accessibilityLabel="上个月"
            accessibilityRole="button"
            onPress={() => setMonth(value => changeMonth(value, -1))}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>‹</Text>
          </Pressable>
          <View style={styles.monthIdentity}>
            <Text style={styles.monthTitle}>{monthLabel(month)}</Text>
            <Text style={styles.monthCount}>
              {loading ? '正在同步本地账本' : `共 ${transactions.length} 笔`}
            </Text>
          </View>
          <Pressable
            accessibilityLabel="下个月"
            accessibilityRole="button"
            onPress={() => setMonth(value => changeMonth(value, 1))}
            style={styles.monthButton}
          >
            <Text style={styles.monthButtonText}>›</Text>
          </Pressable>
        </View>
        <View style={styles.searchRow}>
          <View style={styles.searchField}>
            <View style={styles.searchGlyph}>
              <View style={styles.searchCircle} />
              <View style={styles.searchHandle} />
            </View>
            <TextInput
              accessibilityLabel="搜索流水"
              onChangeText={setQuery}
              placeholder="搜索商户、备注、分类、标签…"
              placeholderTextColor={colors.inkMuted}
              style={styles.search}
              value={query}
            />
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => setShowFilters(value => !value)}
            style={[
              styles.filterToggle,
              showFilters && styles.activeFilterToggle,
            ]}
          >
            <Text
              style={[
                styles.filterToggleText,
                showFilters && styles.activeFilterToggleText,
              ]}
            >
              筛选
            </Text>
          </Pressable>
        </View>
        <ScrollView
          contentContainerStyle={styles.typeFilters}
          horizontal
          showsHorizontalScrollIndicator={false}
        >
          <Pressable
            accessibilityRole="button"
            onPress={() =>
              setFilters(current => ({ ...current, type: undefined }))
            }
            style={[
              styles.filterChip,
              filters.type === undefined && styles.activeFilterChip,
            ]}
          >
            <Text
              style={[
                styles.filterChipText,
                filters.type === undefined && styles.activeFilterChipText,
              ]}
            >
              全部类型
            </Text>
          </Pressable>
          {TRANSACTION_TYPE_OPTIONS.map(option => (
            <Pressable
              accessibilityRole="button"
              key={option.value}
              onPress={() =>
                setFilters(current => ({ ...current, type: option.value }))
              }
              style={[
                styles.filterChip,
                filters.type === option.value && styles.activeFilterChip,
              ]}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filters.type === option.value && styles.activeFilterChipText,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
        {showFilters ? (
          <View style={styles.detailFilters}>
            {(
              [
                [
                  'category',
                  '分类',
                  optionLabel(categoryOptions, filters.categoryId, '全部分类'),
                ],
                [
                  'account',
                  '账户',
                  optionLabel(accountOptions, filters.accountId, '全部账户'),
                ],
                [
                  'project',
                  '项目',
                  optionLabel(projectOptions, filters.projectId, '全部项目'),
                ],
                [
                  'tag',
                  '标签',
                  optionLabel(tagOptions, filters.tagId, '全部标签'),
                ],
              ] as const
            ).map(([key, label, value]) => (
              <Pressable
                accessibilityRole="button"
                key={key}
                onPress={() => setFilterModal(key)}
                style={styles.detailFilter}
              >
                <Text style={styles.detailFilterLabel}>{label}</Text>
                <Text numberOfLines={1} style={styles.detailFilterValue}>
                  {value}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : null}
      </View>

      {error === undefined ? null : (
        <Text accessibilityRole="alert" style={styles.error}>
          {error}
        </Text>
      )}
      {loading ? (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.brand} />
          <Text style={styles.muted}>正在读取流水…</Text>
        </View>
      ) : (
        <SectionList
          contentContainerStyle={
            sections.length === 0 ? styles.emptyList : styles.list
          }
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.id}
          ListEmptyComponent={
            <View style={styles.empty}>
              <View style={styles.emptyIcon}>
                <View style={styles.emptyIconLineLong} />
                <View style={styles.emptyIconLine} />
                <View style={styles.emptyIconLineLong} />
              </View>
              <Text style={styles.emptyTitle}>
                {mode === 'active' ? '这个月还没有流水' : '回收站中没有记录'}
              </Text>
              <Text style={styles.muted}>
                {mode === 'active'
                  ? '点击下方按钮记下第一笔。'
                  : '删除的交易会暂存在这里。'}
              </Text>
            </View>
          }
          renderItem={({ item }) => (
            <TransactionRow
              mode={mode}
              onDelete={() => softDelete(item)}
              onEdit={() => edit(item.id)}
              onRestore={() => restore(item.id)}
              transaction={item}
            />
          )}
          renderSectionHeader={({ section }) => (
            <Text style={styles.sectionHeader}>{section.title}</Text>
          )}
          sections={sections}
          stickySectionHeadersEnabled={false}
        />
      )}

      {mode === 'active' ? (
        <Pressable
          accessibilityRole="button"
          onPress={() => navigation.navigate('ManualEntry', undefined)}
          style={styles.addButton}
        >
          <Text style={styles.addButtonText}>＋ 手动记账</Text>
        </Pressable>
      ) : null}

      <SelectionModal
        allowClear
        onChange={ids => setSingleFilter('categoryId', ids)}
        onClose={() => setFilterModal(undefined)}
        options={categoryOptions}
        selectedIds={
          filters.categoryId === undefined ? [] : [filters.categoryId]
        }
        title="筛选分类"
        visible={filterModal === 'category'}
      />
      <SelectionModal
        allowClear
        onChange={ids => setSingleFilter('accountId', ids)}
        onClose={() => setFilterModal(undefined)}
        options={accountOptions}
        selectedIds={filters.accountId === undefined ? [] : [filters.accountId]}
        title="筛选账户"
        visible={filterModal === 'account'}
      />
      <SelectionModal
        allowClear
        onChange={ids => setSingleFilter('projectId', ids)}
        onClose={() => setFilterModal(undefined)}
        options={projectOptions}
        selectedIds={filters.projectId === undefined ? [] : [filters.projectId]}
        title="筛选项目"
        visible={filterModal === 'project'}
      />
      <SelectionModal
        allowClear
        onChange={ids => setSingleFilter('tagId', ids)}
        onClose={() => setFilterModal(undefined)}
        options={tagOptions}
        selectedIds={filters.tagId === undefined ? [] : [filters.tagId]}
        title="筛选标签"
        visible={filterModal === 'tag'}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  toolbar: {
    gap: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.md,
  },
  segmented: {
    flexDirection: 'row',
    borderRadius: radius.md,
    backgroundColor: colors.surfaceMuted,
    padding: 4,
  },
  segment: {
    minHeight: control.minTouchTarget,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    paddingVertical: 9,
  },
  selectedSegment: {
    backgroundColor: colors.surface,
    ...shadows.card,
  },
  segmentText: { color: colors.inkMuted, fontWeight: '700' },
  selectedSegmentText: { color: colors.ink },
  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  monthButton: {
    width: control.minTouchTarget,
    height: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  monthButtonText: { color: colors.brand, fontSize: 27, lineHeight: 30 },
  monthIdentity: { minWidth: 118, alignItems: 'center', gap: 1 },
  monthTitle: {
    textAlign: 'center',
    color: colors.ink,
    fontSize: typography.title,
    fontWeight: '800',
  },
  monthCount: { color: colors.inkMuted, fontSize: 10, fontWeight: '600' },
  searchRow: { flexDirection: 'row', gap: spacing.xs },
  searchField: {
    minHeight: control.minTouchTarget,
    minWidth: 0,
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    paddingLeft: 11,
  },
  searchGlyph: { position: 'relative', width: 18, height: 18 },
  searchCircle: {
    width: 11,
    height: 11,
    borderWidth: 1.8,
    borderColor: colors.inkMuted,
    borderRadius: radius.pill,
  },
  searchHandle: {
    position: 'absolute',
    right: 1,
    bottom: 2,
    width: 7,
    height: 1.8,
    borderRadius: radius.pill,
    backgroundColor: colors.inkMuted,
    transform: [{ rotate: '45deg' }],
  },
  search: {
    minWidth: 0,
    flex: 1,
    color: colors.ink,
    paddingHorizontal: spacing.xs,
    paddingVertical: 9,
  },
  filterToggle: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
  },
  activeFilterToggle: {
    borderColor: colors.brand,
    backgroundColor: colors.brandSoft,
  },
  filterToggleText: { color: colors.inkSecondary, fontWeight: '700' },
  activeFilterToggleText: { color: colors.brandPressed },
  typeFilters: { gap: 8, paddingRight: 12 },
  filterChip: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: colors.transparent,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceMuted,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  activeFilterChip: {
    borderColor: colors.brand,
    backgroundColor: colors.brand,
  },
  filterChipText: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '600',
  },
  activeFilterChipText: { color: colors.white },
  detailFilters: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  detailFilter: {
    width: '48%',
    gap: 2,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceMuted,
    padding: 10,
  },
  detailFilterLabel: { color: colors.inkMuted, fontSize: 11 },
  detailFilterValue: {
    color: colors.inkSecondary,
    fontSize: 13,
    fontWeight: '700',
  },
  list: { gap: spacing.sm, padding: spacing.sm, paddingBottom: 96 },
  emptyList: { flexGrow: 1, padding: spacing.lg },
  sectionHeader: {
    color: colors.inkSecondary,
    fontSize: 14,
    fontWeight: '800',
    paddingTop: spacing.xs,
    paddingBottom: spacing.xxs,
  },
  transactionCard: {
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    backgroundColor: colors.surface,
    padding: spacing.md,
    ...shadows.card,
  },
  transactionContent: { minHeight: control.minTouchTarget, gap: spacing.xs },
  transactionTop: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  transactionIcon: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    backgroundColor: colors.brandSoft,
  },
  transactionIconText: {
    color: colors.brand,
    fontSize: 14,
    fontWeight: '900',
  },
  transactionMain: { flex: 1, gap: 4 },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  transactionTitle: {
    flexShrink: 1,
    color: colors.ink,
    fontSize: typography.bodyLarge,
    fontWeight: '800',
  },
  duplicateBadge: {
    borderRadius: 6,
    backgroundColor: colors.warningSoft,
    color: colors.warningText,
    fontSize: 10,
    paddingHorizontal: 5,
    paddingVertical: 2,
  },
  transactionCategory: { color: colors.inkMuted, fontSize: 13 },
  amount: { color: colors.inkSecondary, fontSize: 16, fontWeight: '800' },
  negativeAmount: { color: colors.expenseText },
  positiveAmount: { color: colors.incomeText },
  meta: { color: colors.inkMuted, fontSize: typography.caption },
  tags: { color: colors.brand, fontSize: typography.caption },
  rowActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: spacing.xs,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    paddingTop: spacing.xxs,
  },
  rowActionButton: {
    minWidth: 64,
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  editAction: { color: colors.brand, fontWeight: '700' },
  deleteAction: { color: colors.expenseText, fontWeight: '700' },
  restoreAction: { color: colors.incomeText, fontWeight: '700' },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10 },
  muted: { color: colors.inkMuted, textAlign: 'center' },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  emptyIcon: {
    width: 58,
    height: 58,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    borderRadius: radius.lg,
    backgroundColor: colors.brandSoft,
    marginBottom: spacing.xs,
  },
  emptyIconLine: {
    width: 20,
    height: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  emptyIconLineLong: {
    width: 28,
    height: 2.5,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
  },
  emptyTitle: { color: colors.ink, fontSize: 18, fontWeight: '800' },
  error: {
    backgroundColor: colors.expenseSoft,
    color: colors.expenseText,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  addButton: {
    position: 'absolute',
    right: 18,
    bottom: 20,
    borderRadius: radius.pill,
    backgroundColor: colors.brand,
    paddingHorizontal: 18,
    paddingVertical: 14,
    ...shadows.floating,
  },
  addButtonText: { color: colors.white, fontSize: 15, fontWeight: '800' },
});
