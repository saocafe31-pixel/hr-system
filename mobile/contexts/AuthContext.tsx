import type { Session } from '@supabase/supabase-js';
import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';

import { formatAuthSignInError } from '@/lib/authSignInErrors';
import { supabase, supabaseConfigured } from '@/lib/supabase';
import type { Profile, UserRole } from '@/lib/types';

type AuthContextValue = {
  session: Session | null;
  profile: Profile | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<{ error: Error | null }>;
  signOut: () => Promise<void>;
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

  const loadProfile = useCallback(async (userId: string) => {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, email, full_name, role, branch_id, employee_code, phone, employee_id, avatar_url, community_feed_auto_delete_enabled'
      )
      .eq('id', userId)
      .maybeSingle();
    if (error) {
      setProfile(null);
      return;
    }
    const row = data as Record<string, unknown>;
    setProfile({
      ...(data as Profile),
      branch_id:
        row.branch_id != null && row.branch_id !== ''
          ? Number(row.branch_id)
          : null,
    });
  }, []);

  const refreshProfile = useCallback(async () => {
    const uid = session?.user?.id;
    if (!uid) {
      setProfile(null);
      return;
    }
    await loadProfile(uid);
  }, [loadProfile, session?.user?.id]);

  useEffect(() => {
    if (!supabaseConfigured) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    supabase.auth.getSession().then(({ data: { session: s } }) => {
      if (cancelled) return;
      setSession(s);
      if (s?.user?.id) {
        loadProfile(s.user.id).finally(() => {
          if (!cancelled) setLoading(false);
        });
      } else {
        setLoading(false);
      }
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s?.user?.id) {
        setLoading(true);
        loadProfile(s.user.id).finally(() => setLoading(false));
      } else {
        setProfile(null);
        setLoading(false);
      }
    });

    return () => {
      cancelled = true;
      subscription.unsubscribe();
    };
  }, [loadProfile]);

  const signIn = useCallback(async (email: string, password: string) => {
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });
      return {
        error: error ? new Error(formatAuthSignInError(error)) : null,
      };
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'ไม่สามารถเชื่อมต่อได้ ลองใหม่อีกครั้ง';
      return { error: new Error(message) };
    }
  }, []);

  const signOut = useCallback(async () => {
    await supabase.auth.signOut();
    setProfile(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      profile,
      loading,
      refreshProfile,
      signIn,
      signOut,
    }),
    [session, profile, loading, refreshProfile, signIn, signOut]
  );

  return (
    <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider');
  }
  return ctx;
}

export function useRole(): UserRole | null {
  return useAuth().profile?.role ?? null;
}

export function isManagerOrAdmin(role: UserRole | null) {
  return role === 'manager' || role === 'admin';
}

export function isAdmin(role: UserRole | null) {
  return role === 'admin';
}
