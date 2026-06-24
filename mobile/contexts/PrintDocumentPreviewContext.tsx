import FontAwesome from '@expo/vector-icons/FontAwesome';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppTheme } from '@/contexts/AppThemeContext';
import {
  computePrintPreviewScale,
  expoPrintPageOptions,
  PRINT_PAGE_WIDTH_PX,
  printHtmlInBrowserWindow,
  shouldUseInAppPrintPreview,
  waitForPrintDocumentReady,
  WEB_PRINT_PREVIEW_Z_INDEX,
} from '@/lib/printDocumentSizing';

type PrintPreviewRequest = {
  html: string;
  title: string;
  shareDialogTitle?: string;
};

type PrintDocumentPreviewContextValue = {
  openPrintPreview: (request: PrintPreviewRequest) => void;
};

const PrintDocumentPreviewContext = createContext<PrintDocumentPreviewContextValue | null>(null);

let webPrintPreviewHostEl: HTMLDivElement | null = null;

function getWebPrintPreviewHost(): HTMLDivElement | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  if (!webPrintPreviewHostEl) {
    const el = document.createElement('div');
    el.setAttribute('data-print-preview-host', 'true');
    el.style.position = 'fixed';
    el.style.top = '0';
    el.style.left = '0';
    el.style.right = '0';
    el.style.bottom = '0';
    el.style.display = 'flex';
    el.style.flexDirection = 'column';
    el.style.zIndex = String(WEB_PRINT_PREVIEW_Z_INDEX);
    el.style.pointerEvents = 'none';
    document.body.appendChild(el);
    webPrintPreviewHostEl = el;
  }
  return webPrintPreviewHostEl;
}

function destroyWebPrintPreviewHost() {
  if (Platform.OS !== 'web' || !webPrintPreviewHostEl) return;
  webPrintPreviewHostEl.parentNode?.removeChild(webPrintPreviewHostEl);
  webPrintPreviewHostEl = null;
}

function webPrintPreviewPortal(node: ReactNode, host: HTMLDivElement): ReactNode {
  const { createPortal } = require('react-dom') as typeof import('react-dom');
  return createPortal(node, host);
}

export function PrintDocumentPreviewProvider({ children }: { children: ReactNode }) {
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();
  const { theme } = useAppTheme();
  const c = theme.colors;
  const [visible, setVisible] = useState(false);
  const [request, setRequest] = useState<PrintPreviewRequest | null>(null);
  const [busy, setBusy] = useState<'print' | 'share' | null>(null);
  const [docHeight, setDocHeight] = useState(Math.round(PRINT_PAGE_WIDTH_PX * 1.42));
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const previewScale = useMemo(() => computePrintPreviewScale(width), [width]);
  const scaledWidth = Math.round(PRINT_PAGE_WIDTH_PX * previewScale);
  const scaledHeight = Math.round(docHeight * previewScale);

  const measureIframeDocument = useCallback(() => {
    if (Platform.OS !== 'web') return;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    const root = doc.querySelector('.page, .sheet, main.page, main.sheet, main.report');
    const measured = Math.max(
      doc.documentElement?.scrollHeight ?? 0,
      doc.body?.scrollHeight ?? 0,
      root instanceof HTMLElement ? root.offsetHeight + 32 : 0
    );
    if (measured > 120) {
      setDocHeight(measured);
    }
  }, []);

  const handleIframeLoad = useCallback(() => {
    if (Platform.OS !== 'web') {
      measureIframeDocument();
      return;
    }
    const doc = iframeRef.current?.contentDocument;
    if (!doc) {
      measureIframeDocument();
      return;
    }
    void waitForPrintDocumentReady(doc).then(() => {
      measureIframeDocument();
      setTimeout(measureIframeDocument, 120);
    });
  }, [measureIframeDocument]);

  const close = useCallback(() => {
    setVisible(false);
    setRequest(null);
    setBusy(null);
    setDocHeight(Math.round(PRINT_PAGE_WIDTH_PX * 1.42));
  }, []);

  const openPrintPreview = useCallback(
    (next: PrintPreviewRequest) => {
      if (!shouldUseInAppPrintPreview(width) && Platform.OS === 'web') {
        void printHtmlInBrowserWindow(next.html).catch(() => {
          const w = window.open('', '_blank');
          if (!w) return;
          w.document.open();
          w.document.write(next.html);
          w.document.close();
          w.focus();
          w.print();
        });
        return;
      }
      setDocHeight(Math.round(PRINT_PAGE_WIDTH_PX * 1.42));
      setRequest(next);
      setVisible(true);
    },
    [width]
  );

  useEffect(() => {
    if (!visible || !request || Platform.OS !== 'web') return;
    const timers = [80, 350, 900].map((ms) => setTimeout(measureIframeDocument, ms));
    return () => {
      for (const timer of timers) clearTimeout(timer);
    };
  }, [visible, request, measureIframeDocument, previewScale]);

  const handlePrint = useCallback(async () => {
    if (!request) return;
    setBusy('print');
    try {
      if (Platform.OS === 'web') {
        try {
          await printHtmlInBrowserWindow(request.html);
        } catch {
          iframeRef.current?.contentWindow?.focus();
          iframeRef.current?.contentWindow?.print();
        }
      } else {
        await Print.printAsync({ html: request.html, ...expoPrintPageOptions });
      }
    } finally {
      setBusy(null);
    }
  }, [request]);

  const handleShare = useCallback(async () => {
    if (!request) return;
    setBusy('share');
    try {
      const pdf = await Print.printToFileAsync({
        html: request.html,
        ...expoPrintPageOptions,
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdf.uri, {
          mimeType: 'application/pdf',
          dialogTitle: request.shareDialogTitle ?? request.title,
        });
      }
    } finally {
      setBusy(null);
    }
  }, [request]);

  const value = useMemo(() => ({ openPrintPreview }), [openPrintPreview]);

  const styles = useMemo(
    () =>
      StyleSheet.create({
        backdrop: {
          flex: 1,
          width: '100%',
          minHeight: '100%',
          display: 'flex',
          flexDirection: 'column',
          backgroundColor: c.canvas,
        },
        header: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 8,
          flexShrink: 0,
          zIndex: 10,
          paddingHorizontal: 12,
          paddingBottom: 10,
          borderBottomWidth: 1,
          borderBottomColor: c.borderSoft,
          backgroundColor: c.surfaceElevated,
        },
        backBtn: {
          flexDirection: 'row',
          alignItems: 'center',
          gap: 6,
          paddingVertical: 8,
          paddingHorizontal: 4,
        },
        backText: { color: c.primaryDark, fontSize: 14, fontWeight: '800' },
        headerTitle: {
          flex: 1,
          textAlign: 'center',
          fontSize: 15,
          fontWeight: '800',
          color: c.text,
          marginRight: 72,
        },
        previewWrap: {
          flex: 1,
          flexShrink: 1,
          minHeight: 0,
          backgroundColor: '#e8e8e8',
          ...(Platform.OS === 'web'
            ? {
                overflow: 'auto' as const,
                WebkitOverflowScrolling: 'touch' as const,
                alignItems: 'center' as const,
                paddingVertical: 12,
                paddingHorizontal: 10,
              }
            : {}),
        },
        previewScaler: {
          overflow: 'hidden' as const,
          backgroundColor: '#fff',
          ...(Platform.OS === 'web'
            ? {
                boxShadow: '0 2px 14px rgba(0,0,0,0.12)',
              }
            : {}),
        },
        nativePreviewNote: {
          flex: 1,
          justifyContent: 'center',
          padding: 24,
        },
        nativePreviewText: {
          textAlign: 'center',
          color: c.textSecondary,
          fontSize: 14,
          lineHeight: 22,
        },
        footer: {
          flexDirection: 'row',
          gap: 10,
          flexShrink: 0,
          zIndex: 10,
          paddingHorizontal: 14,
          paddingTop: 10,
          borderTopWidth: 1,
          borderTopColor: c.borderSoft,
          backgroundColor: c.surfaceElevated,
        },
        footerBtn: {
          flex: 1,
          borderRadius: theme.radius.sm,
          paddingVertical: 12,
          alignItems: 'center',
          justifyContent: 'center',
          minHeight: 44,
        },
        printBtn: {
          backgroundColor: c.primary,
        },
        shareBtn: {
          backgroundColor: c.surface,
          borderWidth: 1,
          borderColor: c.borderSoft,
        },
        printBtnText: { color: c.canvas, fontSize: 13, fontWeight: '900' },
        shareBtnText: { color: c.textSecondary, fontSize: 13, fontWeight: '900' },
        disabled: { opacity: 0.6 },
      }),
    [c, theme.radius.sm]
  );

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const host = getWebPrintPreviewHost();
    if (!host) return;
    host.style.pointerEvents = visible ? 'auto' : 'none';
    if (!visible) {
      destroyWebPrintPreviewHost();
    }
  }, [visible]);

  const previewShell =
    visible && request ? (
      <View
        style={[
          styles.backdrop,
          { paddingTop: insets.top, paddingBottom: insets.bottom },
          Platform.OS === 'web'
            ? {
                position: 'fixed' as const,
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
              }
            : null,
        ]}>
        <View style={styles.header}>
          <Pressable style={styles.backBtn} onPress={close}>
            <FontAwesome name="chevron-left" size={13} color={c.primaryDark} />
            <Text style={styles.backText}>ย้อนกลับ</Text>
          </Pressable>
          <Text style={styles.headerTitle} numberOfLines={1}>
            {request.title}
          </Text>
        </View>

        <View style={styles.previewWrap}>
          {Platform.OS === 'web' ? (
            <View
              style={[
                styles.previewScaler,
                { width: scaledWidth, height: scaledHeight },
              ]}>
              {createElement('iframe', {
                ref: iframeRef,
                title: request.title,
                srcDoc: request.html,
                onLoad: handleIframeLoad,
                style: {
                  border: 0,
                  width: PRINT_PAGE_WIDTH_PX,
                  height: docHeight,
                  backgroundColor: '#fff',
                  display: 'block',
                  transform: previewScale < 1 ? `scale(${previewScale})` : undefined,
                  transformOrigin: 'top left',
                },
              })}
            </View>
          ) : (
            <View style={styles.nativePreviewNote}>
              <Text style={styles.nativePreviewText}>
                กด «พิมพ์» เพื่อเปิดหน้าต่างพิมพ์ของระบบ{'\n'}
                หรือ «บันทึก/แชร์ PDF» เพื่อส่งต่อเอกสาร
              </Text>
            </View>
          )}
        </View>

        <View style={styles.footer}>
          <Pressable
            style={[styles.footerBtn, styles.printBtn, busy && styles.disabled]}
            disabled={busy !== null}
            onPress={() => void handlePrint()}>
            {busy === 'print' ? (
              <ActivityIndicator color={c.canvas} />
            ) : (
              <Text style={styles.printBtnText}>พิมพ์</Text>
            )}
          </Pressable>
          <Pressable
            style={[styles.footerBtn, styles.shareBtn, busy && styles.disabled]}
            disabled={busy !== null}
            onPress={() => void handleShare()}>
            {busy === 'share' ? (
              <ActivityIndicator color={c.primaryDark} />
            ) : (
              <Text style={styles.shareBtnText}>บันทึก / แชร์ PDF</Text>
            )}
          </Pressable>
        </View>
      </View>
    ) : null;

  const webHost =
    Platform.OS === 'web' && visible && request ? getWebPrintPreviewHost() : null;

  return (
    <PrintDocumentPreviewContext.Provider value={value}>
      {children}
      {Platform.OS === 'web' ? (
        webHost ? webPrintPreviewPortal(previewShell, webHost) : null
      ) : (
        <Modal
          visible={visible}
          animationType="slide"
          presentationStyle="fullScreen"
          statusBarTranslucent
          onRequestClose={close}>
          {previewShell}
        </Modal>
      )}
    </PrintDocumentPreviewContext.Provider>
  );
}

export function usePrintDocumentPreview(): PrintDocumentPreviewContextValue {
  const ctx = useContext(PrintDocumentPreviewContext);
  if (!ctx) {
    throw new Error('usePrintDocumentPreview must be used within PrintDocumentPreviewProvider');
  }
  return ctx;
}
