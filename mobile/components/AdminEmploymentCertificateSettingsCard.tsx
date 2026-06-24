import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import type { AppTheme } from '@/constants/Theme';
import { useAppTheme } from '@/contexts/AppThemeContext';
import { useCuteToast } from '@/contexts/CuteToastContext';
import {
  emptyEmploymentCertificateSettings,
  loadEmploymentCertificateSettings,
  saveEmploymentCertificateSettings,
  type EmploymentCertificateSettings,
} from '@/lib/employmentCertificateSettings';
import { pickAndUploadCertificateAsset } from '@/lib/uploadCertificateAsset';

export function AdminEmploymentCertificateSettingsCard() {
  const toast = useCuteToast();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const styles = useMemo(() => createStyles(theme), [theme]);
  const [settings, setSettings] = useState<EmploymentCertificateSettings>(
    emptyEmploymentCertificateSettings
  );
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<'signature' | 'logo' | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await loadEmploymentCertificateSettings();
      setSettings(data);
    } catch (e) {
      toast.error('โหลดตั้งค่าไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    setSaving(true);
    try {
      await saveEmploymentCertificateSettings(settings);
      toast.success('บันทึกตั้งค่าหนังสือรับรองแล้ว', 'พนักงานจะเห็นลายเซ็นและข้อมูลผู้ลงนามในเอกสาร');
      await load();
    } catch (e) {
      toast.error('บันทึกไม่สำเร็จ', e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAsset(kind: 'signature' | 'logo') {
    setUploading(kind);
    try {
      const url = await pickAndUploadCertificateAsset(kind);
      const next: EmploymentCertificateSettings =
        kind === 'signature'
          ? { ...settings, signatureUrl: url }
          : { ...settings, logoUrl: url };
      setSettings(next);
      await saveEmploymentCertificateSettings(next);
      toast.success(
        kind === 'signature' ? 'บันทึกลายเซ็นแล้ว' : 'บันทึกโลโก้แล้ว',
        'พนักงานจะเห็นในเอกสารหนังสือรับรองทันที'
      );
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (!msg.includes('ยกเลิก')) {
        toast.error('อัปโหลดไม่สำเร็จ', msg);
      }
    } finally {
      setUploading(null);
    }
  }

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.title}>ตั้งค่าหนังสือรับรองการทำงาน</Text>
          <Text style={styles.sub}>
            ตั้งค่าลายเซ็น ชื่อผู้ลงนาม และหมายเหตุท้ายเอกสาร — ใช้ร่วมกับการออกหนังสือรับรองของพนักงานและแอดมิน
          </Text>
        </View>
        {loading ? <ActivityIndicator color={c.primary} /> : null}
      </View>

      <Text style={styles.label}>ชื่อผู้ลงนาม</Text>
      <TextInput
        style={styles.input}
        placeholder="เช่น คุณณัฐพล ไชยจันลา"
        value={settings.signerName}
        onChangeText={(signerName) => setSettings((prev) => ({ ...prev, signerName }))}
      />

      <Text style={styles.label}>ตำแหน่งผู้ลงนาม</Text>
      <TextInput
        style={styles.input}
        placeholder="เช่น ประธานกรรมการบริษัท"
        value={settings.signerTitle}
        onChangeText={(signerTitle) => setSettings((prev) => ({ ...prev, signerTitle }))}
      />

      <Text style={styles.label}>หมายเหตุท้ายเอกสาร</Text>
      <TextInput
        style={[styles.input, styles.tall]}
        placeholder="หมายเหตุ: ฝ่ายทรัพยากรมนุษย์ โทร. ..."
        value={settings.hrFooterNote}
        onChangeText={(hrFooterNote) => setSettings((prev) => ({ ...prev, hrFooterNote }))}
        multiline
      />

      <Text style={styles.label}>ลายเซ็น (รูปภาพ)</Text>
      <View style={styles.assetRow}>
        {settings.signatureUrl ? (
          <Image source={{ uri: settings.signatureUrl }} style={styles.preview} resizeMode="contain" />
        ) : (
          <Text style={styles.muted}>ยังไม่มีลายเซ็น</Text>
        )}
        <Pressable
          style={[styles.uploadBtn, uploading === 'signature' && styles.disabled]}
          disabled={uploading !== null}
          onPress={() => void uploadAsset('signature')}>
          {uploading === 'signature' ? (
            <ActivityIndicator color={c.primaryDark} />
          ) : (
            <Text style={styles.uploadBtnText}>อัปโหลดลายเซ็น</Text>
          )}
        </Pressable>
      </View>

      <Text style={styles.label}>โลโก้บนหนังสือรับรอง (ไม่บังคับ)</Text>
      <Text style={styles.hint}>ถ้าไม่ใส่ จะใช้ชื่อบริษัทจากข้อมูลหัวสลิปแทน</Text>
      <View style={styles.assetRow}>
        {settings.logoUrl ? (
          <Image source={{ uri: settings.logoUrl }} style={styles.preview} resizeMode="contain" />
        ) : (
          <Text style={styles.muted}>ยังไม่มีโลโก้เฉพาะ</Text>
        )}
        <Pressable
          style={[styles.uploadBtn, uploading === 'logo' && styles.disabled]}
          disabled={uploading !== null}
          onPress={() => void uploadAsset('logo')}>
          {uploading === 'logo' ? (
            <ActivityIndicator color={c.primaryDark} />
          ) : (
            <Text style={styles.uploadBtnText}>อัปโหลดโลโก้</Text>
          )}
        </Pressable>
      </View>

      <Pressable
        style={[styles.saveBtn, (saving || loading) && styles.disabled]}
        disabled={saving || loading}
        onPress={() => void save()}>
        {saving ? (
          <ActivityIndicator color={c.canvas} />
        ) : (
          <Text style={styles.saveBtnText}>บันทึกตั้งค่าหนังสือรับรอง</Text>
        )}
      </Pressable>
    </View>
  );
}

function createStyles(theme: AppTheme) {
  const c = theme.colors;
  const r = theme.radius;

  return StyleSheet.create({
    card: {
      marginTop: 16,
      padding: 14,
      borderRadius: r.lg,
      backgroundColor: c.surfaceElevated,
      borderWidth: 1,
      borderColor: c.borderSoft,
    },
    header: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginBottom: 12 },
    title: { fontSize: 16, fontWeight: '800', color: c.text },
    sub: { marginTop: 4, color: c.textMuted, fontSize: 12, lineHeight: 17 },
    label: { marginTop: 10, marginBottom: 4, color: c.textSecondary, fontSize: 12, fontWeight: '800' },
    hint: { marginBottom: 6, color: c.textMuted, fontSize: 11 },
    input: {
      borderRadius: r.sm,
      borderWidth: 1,
      borderColor: c.borderSoft,
      backgroundColor: c.surface,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: c.text,
      fontSize: 14,
    },
    tall: { minHeight: 72, textAlignVertical: 'top' },
    assetRow: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      flexWrap: 'wrap',
    },
    preview: { width: 120, height: 56, backgroundColor: c.surfaceMuted, borderRadius: r.sm },
    muted: { color: c.textMuted, fontSize: 12 },
    uploadBtn: {
      borderRadius: r.sm,
      borderWidth: 1,
      borderColor: c.primaryMuted,
      backgroundColor: c.primaryLight,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    uploadBtnText: { color: c.primaryDark, fontSize: 12, fontWeight: '900' },
    saveBtn: {
      marginTop: 16,
      borderRadius: r.sm,
      backgroundColor: c.primary,
      paddingVertical: 12,
      alignItems: 'center',
    },
    saveBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
    disabled: { opacity: 0.6 },
  });
}
