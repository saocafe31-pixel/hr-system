import {
  createElement,
  useEffect,
  useMemo,
  useState,
  type ChangeEvent,
} from 'react';
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
} from '@react-native-community/datetimepicker';

import { NatureTheme, type AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { dateToBangkokYmd } from '@/lib/taskHelpers';

type Props = {
  label: string;
  value: Date | null;
  onChange: (d: Date | null) => void;
  disabled?: boolean;
  /** จำกัดช่วงวันที่ (ถ้ามี) */
  minimumDate?: Date;
  maximumDate?: Date;
};

const c = NatureTheme.colors;
const r = NatureTheme.radius;

const WEB_DATE_MODAL = Platform.select({
  web: {
    position: 'fixed' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1_500_000,
  },
  default: {},
});

function formatTh(d: Date | null): string {
  if (!d) return 'แตะเพื่อเลือกวันที่';
  try {
    return d.toLocaleDateString('th-TH', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    });
  } catch {
    return String(d);
  }
}

export function DatePickerField({
  label,
  value,
  onChange,
  disabled,
  minimumDate,
  maximumDate,
}: Props) {
  const { theme, themeId } = useAppTheme();
  const tc = theme.colors;
  const themed = useMemo(() => createDatePickerThemeStyles(tc), [tc]);
  const lightMode = themeId === 'foliageLight';
  const [iosOpen, setIosOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(value ?? new Date());

  useEffect(() => {
    if (iosOpen) setTemp(value ?? new Date());
  }, [iosOpen, value]);

  function openPicker() {
    if (disabled) return;
    const base = value ?? new Date();
    setTemp(base);

    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value: base,
        mode: 'date',
        minimumDate,
        maximumDate,
        onChange: (event, date) => {
          if (event.type === 'dismissed') return;
          if (date) onChange(date);
        },
      });
      return;
    }

    if (Platform.OS === 'web' || Platform.OS === 'ios') {
      setIosOpen(true);
    }
  }

  function confirmIos() {
    onChange(temp);
    setIosOpen(false);
  }

  return (
    <View style={styles.root}>
      <Text style={[styles.label, themed.label]}>{label}</Text>
      <Pressable
        style={[styles.field, themed.field, disabled && styles.fieldDisabled]}
        onPress={openPicker}
        disabled={disabled}
        accessibilityRole="button"
        accessibilityLabel={label}>
        <Text
          style={[
            styles.fieldText,
            themed.fieldText,
            !value && styles.placeholder,
            !value && themed.placeholder,
          ]}>
          {formatTh(value)}
        </Text>
      </Pressable>

      {(Platform.OS === 'ios' || Platform.OS === 'web') && (
        <Modal
          visible={iosOpen}
          transparent
          animationType="fade"
          onRequestClose={() => setIosOpen(false)}>
          <View style={[styles.modalRoot, themed.modalRoot, WEB_DATE_MODAL]}>
            <Pressable
              style={styles.modalFlex}
              onPress={() => setIosOpen(false)}
            />
            <View style={[styles.sheet, themed.sheet]}>
              <Text style={[styles.sheetTitle, themed.sheetTitle]}>เลือกวันที่</Text>
              {Platform.OS === 'web' ? (
                <View style={styles.pickerWrap}>
                  {createElement('input', {
                    type: 'date',
                    value: dateToBangkokYmd(temp),
                    min: minimumDate
                      ? dateToBangkokYmd(minimumDate)
                      : undefined,
                    max: maximumDate
                      ? dateToBangkokYmd(maximumDate)
                      : undefined,
                    onChange: (e: ChangeEvent<HTMLInputElement>) => {
                      const raw = e.target.value;
                      if (!raw) return;
                      setTemp(new Date(`${raw}T12:00:00+07:00`));
                    },
                    style: {
                      width: '100%',
                      fontSize: 18,
                      padding: '14px 12px',
                      borderRadius: r.sm,
                      border: `2px solid ${tc.border}`,
                      boxSizing: 'border-box',
                      color: tc.text,
                      backgroundColor: lightMode ? '#FFFFFF' : tc.surfaceMuted,
                      colorScheme: lightMode ? 'light' : 'dark',
                      outline: 'none',
                      boxShadow: lightMode ? `0 0 0 3px ${tc.primaryLight}` : 'none',
                      WebkitTextFillColor: tc.text,
                    },
                  })}
                </View>
              ) : (
                <View style={styles.pickerWrap}>
                  <DateTimePicker
                    value={temp}
                    mode="date"
                    display="inline"
                    themeVariant="light"
                    minimumDate={minimumDate}
                    maximumDate={maximumDate}
                    onChange={(_, date) => {
                      if (date) setTemp(date);
                    }}
                    style={styles.iosPicker}
                  />
                </View>
              )}
              <View style={styles.sheetActions}>
                <Pressable
                  style={styles.textBtn}
                  onPress={() => {
                    onChange(null);
                    setIosOpen(false);
                  }}>
                  <Text style={[styles.linkText, themed.linkText]}>ล้างวันที่</Text>
                </Pressable>
                <View style={styles.sheetRight}>
                  <Pressable
                    style={styles.textBtn}
                    onPress={() => setIosOpen(false)}>
                    <Text style={[styles.cancelText, themed.cancelText]}>ยกเลิก</Text>
                  </Pressable>
                  <Pressable style={[styles.okBtn, themed.okBtn]} onPress={confirmIos}>
                    <Text style={styles.okText}>ตกลง</Text>
                  </Pressable>
                </View>
              </View>
            </View>
          </View>
        </Modal>
      )}
    </View>
  );
}

function createDatePickerThemeStyles(colors: AppTheme['colors']) {
  return StyleSheet.create({
    label: { color: colors.textSecondary },
    field: {
      borderColor: colors.border,
      borderWidth: 2,
      backgroundColor: colors.surface,
    },
    fieldText: { color: colors.text },
    placeholder: { color: colors.textMuted },
    modalRoot: { backgroundColor: colors.overlay },
    sheet: {
      backgroundColor: colors.surface,
      borderColor: colors.border,
      borderWidth: 2,
      shadowColor: colors.shadow,
      shadowOpacity: 0.18,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
    },
    sheetTitle: { color: colors.text },
    linkText: { color: colors.link },
    cancelText: { color: colors.textMuted },
    okBtn: { backgroundColor: colors.primaryDark },
  });
}

const styles = StyleSheet.create({
  label: {
    fontWeight: '600',
    fontSize: 13,
    color: c.textSecondary,
    marginBottom: 6,
    marginTop: 8,
  },
  root: {
    alignSelf: 'stretch',
    minWidth: 0,
  },
  field: {
    alignSelf: 'stretch',
    minWidth: 0,
    borderWidth: 1,
    borderColor: c.border,
    borderRadius: r.sm,
    padding: 14,
    backgroundColor: c.surface,
  },
  fieldDisabled: { opacity: 0.55 },
  fieldText: { fontSize: 16, color: c.text },
  placeholder: { color: c.textMuted },
  modalRoot: {
    flex: 1,
    justifyContent: 'flex-end',
    backgroundColor: c.overlay,
  },
  modalFlex: {
    flex: 1,
  },
  sheet: {
    alignSelf: 'center',
    width: '92%',
    maxWidth: 420,
    marginBottom: 10,
    backgroundColor: c.surfaceElevated,
    borderRadius: r.xl,
    padding: 16,
    paddingBottom: 28,
    borderWidth: 1,
    borderColor: c.borderSoft,
  },
  sheetTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: c.text,
    textAlign: 'center',
    marginBottom: 8,
  },
  sheetActions: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 12,
    gap: 10,
  },
  sheetRight: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: 10,
    flexShrink: 1,
  },
  textBtn: { paddingVertical: 8, paddingHorizontal: 4 },
  linkText: { color: c.link, fontWeight: '600' },
  cancelText: { color: c.textMuted, fontWeight: '600' },
  okBtn: {
    backgroundColor: c.primary,
    paddingHorizontal: 22,
    paddingVertical: 11,
    borderRadius: r.md,
  },
  okText: { color: c.onAccent, fontWeight: '700' },
  pickerWrap: {
    alignSelf: 'center',
    width: '100%',
    maxWidth: 360,
    minWidth: 0,
    minHeight: 56,
    marginVertical: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iosPicker: {
    alignSelf: 'center',
    width: '100%',
    minHeight: 340,
  },
});
