import { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  attachLeaveRequestEvidence,
  leaveAllowsEvidenceAttachmentRow,
  leaveEvidenceFileLabel,
  leaveEvidenceUrl,
  openLeaveEvidenceUrl,
} from '@/lib/leaveEvidenceAttachment';
import { pickAndUploadLeaveAttachment } from '@/lib/uploadLeaveAttachment';
import type { LeaveRequestRow } from '@/lib/types';

type Props = {
  row: LeaveRequestRow;
  /** พนักงานเจ้าของคำขอ — แสดงปุ่มแนบ/เปลี่ยน */
  mode: 'employee' | 'viewer';
  uploadUserId?: string | null;
  onUpdated?: (row: LeaveRequestRow) => void;
};

export function LeaveHistoryEvidenceActions({
  row,
  mode,
  uploadUserId,
  onUpdated,
}: Props) {
  const { theme } = useAppTheme();
  const styles = createStyles(theme);
  const toast = useCuteToast();
  const [uploading, setUploading] = useState(false);

  const allows = leaveAllowsEvidenceAttachmentRow(row);
  const url = leaveEvidenceUrl(row);

  if (!allows && !url) return null;

  async function handleUpload() {
    if (!uploadUserId) return;
    setUploading(true);
    try {
      const uploaded = await pickAndUploadLeaveAttachment(uploadUserId);
      const updated = await attachLeaveRequestEvidence(row.id, uploaded.url);
      onUpdated?.(updated);
      toast.success('อัปโหลดแล้ว', 'บันทึกหลักฐานการลาเรียบร้อย');
    } catch (e) {
      toast.error('อัปโหลดไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setUploading(false);
    }
  }

  return (
    <View style={styles.row}>
      {url ? (
        <>
          <Text style={styles.hasDoc}>
            มีหลักฐานแนบ ({leaveEvidenceFileLabel(url)})
          </Text>
          <Pressable
            style={styles.viewBtn}
            onPress={() => openLeaveEvidenceUrl(url)}>
            <Text style={styles.viewBtnText}>ดูหลักฐาน</Text>
          </Pressable>
        </>
      ) : allows ? (
        <Text style={styles.missingDoc}>ยังไม่มีหลักฐานแนบ</Text>
      ) : null}
      {mode === 'employee' && allows ? (
        <Pressable
          style={[styles.attachBtn, uploading && styles.disabled]}
          disabled={uploading}
          onPress={() => void handleUpload()}>
          {uploading ? (
            <ActivityIndicator size="small" color={theme.colors.primaryDark} />
          ) : (
            <Text style={styles.attachBtnText}>
              {url ? 'เปลี่ยนหลักฐาน' : 'แนบหลักฐาน (PDF/รูป)'}
            </Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  return StyleSheet.create({
    row: {
      marginTop: 8,
      flexDirection: 'row',
      flexWrap: 'wrap',
      alignItems: 'center',
      gap: 8,
    },
    hasDoc: {
      color: c.primaryDark,
      fontSize: 11,
      fontWeight: '700',
    },
    missingDoc: {
      color: c.warningTitle,
      fontSize: 11,
      fontWeight: '600',
    },
    viewBtn: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: theme.radius.sm,
      backgroundColor: c.primaryLight,
      borderWidth: 1,
      borderColor: c.primaryMuted,
    },
    viewBtnText: {
      color: c.primaryDark,
      fontSize: 11,
      fontWeight: '800',
    },
    attachBtn: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: theme.radius.sm,
      backgroundColor: c.surfaceMuted,
      borderWidth: 1,
      borderColor: c.border,
      minWidth: 120,
      alignItems: 'center',
    },
    attachBtnText: {
      color: c.text,
      fontSize: 11,
      fontWeight: '700',
    },
    disabled: { opacity: 0.55 },
  });
}
