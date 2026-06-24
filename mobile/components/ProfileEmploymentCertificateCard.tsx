import { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import { usePrintDocumentPreview } from '@/contexts/PrintDocumentPreviewContext';
import { loadMyEmploymentCertificatePayload } from '@/lib/employmentCertificateData';
import { prepareEmploymentCertificateHtml } from '@/lib/employmentCertificatePdf';

type Props = {
  userId: string | null | undefined;
};

export function ProfileEmploymentCertificateCard({ userId }: Props) {
  const toast = useCuteToast();
  const { openPrintPreview } = usePrintDocumentPreview();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [exporting, setExporting] = useState<'with' | 'without' | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<'with' | 'without'>('without');

  const exportCertificate = useCallback(
    async (withSalary: boolean) => {
      if (!userId) {
        toast.info('ยังไม่พร้อม', 'กรุณาเข้าสู่ระบบก่อน');
        return;
      }
      setSelectedVariant(withSalary ? 'with' : 'without');
      setExporting(withSalary ? 'with' : 'without');
      try {
        const payload = await loadMyEmploymentCertificatePayload(withSalary);
        const html = await prepareEmploymentCertificateHtml(payload);
        openPrintPreview({
          html,
          title: withSalary ? 'หนังสือรับรอง (ระบุเงินเดือน)' : 'หนังสือรับรองการทำงาน',
          shareDialogTitle: withSalary
            ? 'หนังสือรับรองการทำงาน (ระบุเงินเดือน)'
            : 'หนังสือรับรองการทำงาน',
        });
        toast.success('เปิดตัวอย่างเอกสารแล้ว', 'กดพิมพ์หรือบันทึก PDF จากแถบด้านล่าง');
      } catch (e) {
        toast.error('ออกหนังสือรับรองไม่สำเร็จ', e instanceof Error ? e.message : String(e));
      } finally {
        setExporting(null);
      }
    },
    [toast, userId, openPrintPreview]
  );

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>หนังสือรับรองการทำงาน</Text>
          <Text style={styles.sub}>
            ดาวน์โหลดหรือพิมพ์หนังสือรับรองของคุณได้ทันที — ข้อมูลดึงจากระบบ HR
          </Text>
        </View>
      </View>

      <View style={styles.infoBox}>
        <Text style={styles.infoTitle}>เกี่ยวกับหนังสือรับรอง</Text>
        <Text style={styles.infoText}>
          ออกเอกสารรับรองการทำงานจากข้อมูล HR ในระบบ — เลือกแบบไม่ระบุเงินเดือนสำหรับยื่นทั่วไป
          หรือแบบระบุฐานเงินเดือนเมื่อหน่วยงานต้องการระบุอัตราค่าจ้าง
          {'\n'}กดปุ่มด้านล่างแล้วเลือกพิมพ์หรือบันทึกเป็น PDF
        </Text>
      </View>

      <Pressable
        style={[
          styles.optionBtn,
          selectedVariant === 'without' && styles.optionBtnSelected,
          exporting === 'without' && styles.disabled,
        ]}
        disabled={exporting !== null}
        onPress={() => void exportCertificate(false)}>
        {exporting === 'without' ? (
          <ActivityIndicator color={c.primaryDark} />
        ) : (
          <Text
            style={[
              styles.optionBtnText,
              selectedVariant === 'without' && styles.optionBtnTextSelected,
            ]}>
            หนังสือรับรอง (ไม่ระบุเงินเดือน)
          </Text>
        )}
      </Pressable>

      <Pressable
        style={[
          styles.optionBtn,
          styles.optionBtnSpaced,
          selectedVariant === 'with' && styles.optionBtnSelected,
          exporting === 'with' && styles.disabled,
        ]}
        disabled={exporting !== null}
        onPress={() => void exportCertificate(true)}>
        {exporting === 'with' ? (
          <ActivityIndicator color={c.primaryDark} />
        ) : (
          <Text
            style={[
              styles.optionBtnText,
              selectedVariant === 'with' && styles.optionBtnTextSelected,
            ]}>
            หนังสือรับรอง (ระบุฐานเงินเดือน)
          </Text>
        )}
      </Pressable>

      <Text style={styles.note}>
        แบบระบุเงินเดือนต้องมีฐานเงินเดือนในระบบ Payroll — หากยังไม่มีให้ติดต่อ HR
      </Text>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;
  const sectionAccent =
    c.canvas === '#F8FAF1'
      ? { borderLeftWidth: 4, borderLeftColor: c.primaryMuted, paddingLeft: 10 }
      : {};

  return StyleSheet.create({
    card: {
      marginTop: 14,
      padding: 14,
      borderRadius: r.lg,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.borderSoft,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 12 },
    title: { fontSize: 17, fontWeight: '800', color: c.text, ...sectionAccent },
    sub: { marginTop: 3, color: c.textMuted, fontSize: 12, lineHeight: 17 },
    infoBox: {
      marginBottom: 12,
      padding: 10,
      borderRadius: r.sm,
      backgroundColor: c.primaryLight,
      borderWidth: 1,
      borderColor: c.primaryMuted,
    },
    infoTitle: { fontSize: 12, fontWeight: '900', color: c.primaryDark },
    infoText: { marginTop: 6, fontSize: 11, lineHeight: 17, color: c.textSecondary },
    optionBtn: {
      borderRadius: r.sm,
      backgroundColor: c.surface,
      borderWidth: 1,
      borderColor: c.borderSoft,
      paddingVertical: 12,
      alignItems: 'center',
    },
    optionBtnSpaced: { marginTop: 8 },
    optionBtnSelected: {
      backgroundColor: c.primaryLight,
      borderColor: c.primaryMuted,
    },
    optionBtnText: { color: c.textSecondary, fontSize: 13, fontWeight: '900' },
    optionBtnTextSelected: { color: c.primaryDark },
    note: { marginTop: 10, color: c.textMuted, fontSize: 11, lineHeight: 16 },
    disabled: { opacity: 0.6 },
  });
}
