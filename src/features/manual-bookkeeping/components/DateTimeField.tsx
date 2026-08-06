import { useState } from 'react';
import {
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import DateTimePicker, {
  DateTimePickerAndroid,
  type DateTimePickerEvent,
} from '@react-native-community/datetimepicker';

import { formatLocalDateTime } from '../../../domain/services/manualTransaction';

type DateTimeFieldProps = {
  value: Date;
  onChange: (date: Date) => void;
};

function mergeDate(current: Date, selected: Date, mode: 'date' | 'time'): Date {
  const next = new Date(current);

  if (mode === 'date') {
    next.setFullYear(
      selected.getFullYear(),
      selected.getMonth(),
      selected.getDate(),
    );
  } else {
    next.setHours(selected.getHours(), selected.getMinutes(), 0, 0);
  }

  return next;
}

export function DateTimeField({ value, onChange }: DateTimeFieldProps) {
  const [iosMode, setIosMode] = useState<'date' | 'time' | undefined>();

  const open = (mode: 'date' | 'time') => {
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode,
        is24Hour: true,
        maximumDate: new Date(),
        onValueChange: (_event, selectedDate) => {
          onChange(mergeDate(value, selectedDate, mode));
        },
      });
      return;
    }

    setIosMode(mode);
  };

  const onIosChange = (_event: DateTimePickerEvent, selected?: Date) => {
    if (selected !== undefined && iosMode !== undefined) {
      onChange(mergeDate(value, selected, iosMode));
    }
  };

  return (
    <>
      <View style={styles.row}>
        <Text style={styles.value}>{formatLocalDateTime(value)}</Text>
        <Pressable
          accessibilityRole="button"
          onPress={() => open('date')}
          style={styles.action}
        >
          <Text style={styles.actionText}>日期</Text>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          onPress={() => open('time')}
          style={styles.action}
        >
          <Text style={styles.actionText}>时间</Text>
        </Pressable>
      </View>
      {Platform.OS === 'ios' ? (
        <Modal
          animationType="fade"
          onRequestClose={() => setIosMode(undefined)}
          transparent
          visible={iosMode !== undefined}
        >
          <View style={styles.backdrop}>
            <View style={styles.pickerCard}>
              {iosMode === undefined ? null : (
                <DateTimePicker
                  display="spinner"
                  maximumDate={new Date()}
                  mode={iosMode}
                  onChange={onIosChange}
                  value={value}
                />
              )}
              <Pressable
                accessibilityRole="button"
                onPress={() => setIosMode(undefined)}
                style={styles.doneButton}
              >
                <Text style={styles.doneText}>完成</Text>
              </Pressable>
            </View>
          </View>
        </Modal>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  value: { flex: 1, color: '#0F172A', fontSize: 15 },
  action: {
    borderRadius: 10,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 12,
    paddingVertical: 9,
  },
  actionText: { color: '#1D4ED8', fontWeight: '700' },
  backdrop: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: 'rgba(15, 23, 42, 0.35)',
  },
  pickerCard: {
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    backgroundColor: '#FFFFFF',
    padding: 16,
  },
  doneButton: {
    alignItems: 'center',
    borderRadius: 12,
    backgroundColor: '#2563EB',
    padding: 12,
  },
  doneText: { color: '#FFFFFF', fontWeight: '700' },
});
