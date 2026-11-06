'use client';

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import {
  type Role,
  type UserSession,
  AuthMeResponseSchema,
  LoginResponseSchema,
} from '@careloop/shared';
import { apiFetch, onSessionExpired } from './api';
import { getRoleLandingRoute } from './auth';

interface SessionContextValue {
  user: UserSession | null;
  loading: boolean;
  error: Error | null;
  login: (email: string, password: string) => Promise<UserSession>;
  logout: () => Promise<void>;
  refreshSession: () => Promise<UserSession | null>;
}

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined
);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const router = useRouter();

  const fetchSession = useCallback(async (): Promise<UserSession | null> => {
    try {
      const data = await apiFetch('/api/v1/auth/me', {
        method: 'GET',
        schema: AuthMeResponseSchema,
        skipAuthRedirect: true,
      });
      setUser(data.user);
      setError(null);
      return data.user;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSession();
  }, [fetchSession]);

  useEffect(() => {
    const unsubscribe = onSessionExpired(() => {
      setUser(null);
    });
    return unsubscribe;
  }, []);

  const login = useCallback(
    async (email: string, password: string): Promise<UserSession> => {
      const data = await apiFetch('/api/v1/auth/login', {
        method: 'POST',
        body: { email, password },
        schema: LoginResponseSchema,
        skipAuthRedirect: true,
      });
      setUser(data.user);
      setError(null);
      return data.user;
    },
    []
  );

  const logout = useCallback(async (): Promise<void> => {
    try {
      await apiFetch('/api/v1/auth/logout', {
        method: 'POST',
        skipAuthRedirect: true,
      });
    } finally {
      setUser(null);
      router.push('/login');
    }
  }, [router]);

  return (
    <SessionContext.Provider
      value={{
        user,
        loading,
        error,
        login,
        logout,
        refreshSession: fetchSession,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within an AuthProvider');
  }
  return context;
}

export function RoleGuard({
  allowedRole,
  children,
}: {
  allowedRole: Role;
  children: React.ReactNode;
}) {
  const { user, loading } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (!loading) {
      if (!user) {
        router.replace('/login');
      } else if (user.role !== allowedRole) {
        router.replace(getRoleLandingRoute(user.role));
      }
    }
  }, [user, loading, allowedRole, router]);

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <div
          role="status"
          aria-label="Loading session"
          className="h-8 w-8 animate-spin rounded-full border-4 border-teal-600 border-t-transparent"
        />
      </div>
    );
  }

  if (!user || user.role !== allowedRole) {
    return null;
  }

  return <>{children}</>;
}

