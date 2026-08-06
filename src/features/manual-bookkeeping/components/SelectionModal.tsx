import { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  colors,
  control,
  radius,
  spacing,
  typography,
} from '../../../theme/tokens';

export type SelectionOption = {
  id: string;
  label: string;
  detail?: string;
  icon?: string;
};

type SelectionModalProps = {
  visible: boolean;
  title: string;
  options: readonly SelectionOption[];
  selectedIds: readonly string[];
  multiple?: boolean;
  allowClear?: boolean;
  createLabel?: string;
  onCreate?: (name: string) => Promise<string>;
  onChange: (ids: string[]) => void;
  onClose: () => void;
};

export function SelectionModal({
  visible,
  title,
  options,
  selectedIds,
  multiple = false,
  allowClear = false,
  createLabel,
  onCreate,
  onChange,
  onClose,
}: SelectionModalProps) {
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    if (!visible) {
      setQuery('');
      setCreating(false);
    }
  }, [visible]);

  const normalizedQuery = query.trim().toLocaleLowerCase('zh-CN');
  const filteredOptions = useMemo(() => {
    if (normalizedQuery.length === 0) {
      return options;
    }

    return options.filter(option =>
      `${option.label} ${option.detail ?? ''}`
        .toLocaleLowerCase('zh-CN')
        .includes(normalizedQuery),
    );
  }, [normalizedQuery, options]);

  const exactMatch = options.some(
    option => option.label.toLocaleLowerCase('zh-CN') === normalizedQuery,
  );

  const choose = (id: string) => {
    if (!multiple) {
      onChange([id]);
      onClose();
      return;
    }

    onChange(
      selectedIds.includes(id)
        ? selectedIds.filter(selectedId => selectedId !== id)
        : [...selectedIds, id],
    );
  };

  const create = async () => {
    const name = query.trim();
    if (onCreate === undefined || name.length === 0 || exactMatch) {
      return;
    }

    setCreating(true);
    try {
      const id = await onCreate(name);
      if (multiple) {
        onChange([...new Set([...selectedIds, id])]);
        setQuery('');
      } else {
        onChange([id]);
        onClose();
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <Modal
      animationType="slide"
      onRequestClose={onClose}
      presentationStyle="pageSheet"
      visible={visible}
    >
      <SafeAreaView style={styles.safeArea}>
        <View style={styles.header}>
          <Text accessibilityRole="header" style={styles.title}>
            {title}
          </Text>
          <Pressable
            accessibilityRole="button"
            onPress={onClose}
            style={styles.doneButton}
          >
            <Text style={styles.done}>完成</Text>
          </Pressable>
        </View>
        <TextInput
          accessibilityLabel={`搜索${title}`}
          autoCapitalize="none"
          onChangeText={setQuery}
          placeholder={`搜索${title}`}
          placeholderTextColor={colors.placeholder}
          style={styles.search}
          value={query}
        />
        {allowClear && normalizedQuery.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            onPress={() => {
              onChange([]);
              onClose();
            }}
            style={styles.clearRow}
          >
            <Text style={styles.clearText}>不限</Text>
          </Pressable>
        ) : null}
        {onCreate !== undefined && normalizedQuery.length > 0 && !exactMatch ? (
          <Pressable
            accessibilityRole="button"
            disabled={creating}
            onPress={create}
            style={styles.createRow}
          >
            {creating ? <ActivityIndicator color={colors.brand} /> : null}
            <Text style={styles.createText}>
              {createLabel ?? '新建'}“{query.trim()}”
            </Text>
          </Pressable>
        ) : null}
        <FlatList
          contentContainerStyle={styles.list}
          data={filteredOptions}
          keyboardShouldPersistTaps="handled"
          keyExtractor={item => item.id}
          ListEmptyComponent={<Text style={styles.empty}>没有匹配的选项</Text>}
          renderItem={({ item }) => {
            const selected = selectedIds.includes(item.id);
            return (
              <Pressable
                accessibilityRole={multiple ? 'checkbox' : 'button'}
                accessibilityState={{
                  checked: multiple ? selected : undefined,
                }}
                onPress={() => choose(item.id)}
                style={[styles.row, selected && styles.selectedRow]}
              >
                <Text style={styles.icon}>{item.icon ?? '•'}</Text>
                <View style={styles.labelGroup}>
                  <Text style={styles.label}>{item.label}</Text>
                  {item.detail === undefined ? null : (
                    <Text style={styles.detail}>{item.detail}</Text>
                  )}
                </View>
                <Text style={styles.check}>{selected ? '✓' : ''}</Text>
              </Pressable>
            );
          }}
        />
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.canvas },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.borderStrong,
    backgroundColor: colors.surface,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
  },
  title: { color: colors.ink, fontSize: 20, fontWeight: '700' },
  doneButton: {
    minWidth: control.minTouchTarget,
    minHeight: control.minTouchTarget,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
  },
  done: { color: colors.brand, fontSize: 16, fontWeight: '700' },
  search: {
    minHeight: control.minTouchTarget,
    margin: spacing.md,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    color: colors.ink,
    fontSize: 16,
    paddingHorizontal: 14,
    paddingVertical: 11,
  },
  list: {
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.xl,
  },
  row: {
    minHeight: 58,
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  selectedRow: {
    borderWidth: 1,
    borderColor: colors.brandMuted,
    backgroundColor: colors.brandSoft,
  },
  icon: { width: 32, color: colors.inkSecondary, fontSize: 20 },
  labelGroup: { flex: 1, gap: 2 },
  label: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  detail: { color: colors.inkMuted, fontSize: 13 },
  check: { width: 24, color: colors.brand, fontSize: 18, fontWeight: '800' },
  clearRow: {
    minHeight: control.minTouchTarget,
    justifyContent: 'center',
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    padding: 14,
  },
  clearText: { color: colors.inkSecondary, fontWeight: '600' },
  createRow: {
    minHeight: control.minTouchTarget,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginHorizontal: spacing.md,
    marginBottom: spacing.xs,
    borderRadius: radius.md,
    backgroundColor: colors.brandMuted,
    padding: 14,
  },
  createText: { color: colors.brandPressed, fontWeight: '700' },
  empty: {
    paddingVertical: spacing.xxl,
    color: colors.inkMuted,
    fontSize: typography.body,
    textAlign: 'center',
  },
});
