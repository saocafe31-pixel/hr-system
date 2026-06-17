import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

import { AppThemes, type AppTheme, type AppThemeId } from '@/constants/Theme';

const APP_THEME_STORAGE_KEY = 'foliage:app-theme-id';

type AppThemeContextValue = {
  themeId: AppThemeId;
  theme: AppTheme;
  setThemeId: (nextThemeId: AppThemeId) => Promise<void>;
};

const AppThemeContext = createContext<AppThemeContextValue | null>(null);

function normalizeThemeId(raw: string | null): AppThemeId {
  return raw === 'classicDark' ? 'classicDark' : 'foliageLight';
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeIdState] = useState<AppThemeId>('foliageLight');

  useEffect(() => {
    let alive = true;
    AsyncStorage.getItem(APP_THEME_STORAGE_KEY)
      .then((stored) => {
        if (alive) setThemeIdState(normalizeThemeId(stored));
      })
      .catch(() => {
        if (alive) setThemeIdState('foliageLight');
      });
    return () => {
      alive = false;
    };
  }, []);

  const setThemeId = useCallback(async (nextThemeId: AppThemeId) => {
    setThemeIdState(nextThemeId);
    await AsyncStorage.setItem(APP_THEME_STORAGE_KEY, nextThemeId);
  }, []);

  const value = useMemo<AppThemeContextValue>(
    () => ({
      themeId,
      theme: AppThemes[themeId],
      setThemeId,
    }),
    [setThemeId, themeId]
  );

  return <AppThemeContext.Provider value={value}>{children}</AppThemeContext.Provider>;
}

export function useAppTheme(): AppThemeContextValue {
  const ctx = useContext(AppThemeContext);
  if (!ctx) {
    throw new Error('useAppTheme must be used within AppThemeProvider');
  }
  return ctx;
}

export function useOptionalAppTheme(): AppThemeContextValue | null {
  return useContext(AppThemeContext);
}
