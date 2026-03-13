"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { usePathname, useRouter } from "next/navigation";
import type { AuthError, Session, User } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "@/lib/supabase/browser";
import { isAppDomainHost, isAuthRoute, isPublicShareRoute } from "@/lib/domains";

export type OAuthProvider = "github" | "google";

interface AuthContextValue {
  user: User | null;
  session: Session | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<AuthError | null>;
  signUp: (email: string, password: string) => Promise<AuthError | null>;
  signOut: () => Promise<AuthError | null>;
  signInWithOAuth: (provider: OAuthProvider, nextPath?: string) => Promise<AuthError | null>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const supabase = useMemo(() => getSupabaseBrowserClient(), []);
  const router = useRouter();
  const pathname = usePathname();

  const [loading, setLoading] = useState(true);
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    let mounted = true;

    void supabase.auth.getSession().then(({ data }) => {
      if (!mounted) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!mounted) return;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, [supabase]);

  useEffect(() => {
    if (loading) return;
    if (typeof window === "undefined") return;

    const authRequired = isAppDomainHost(window.location.host);
    if (!authRequired) return;

    const authPage = isAuthRoute(pathname);
    const publicShareRoute = isPublicShareRoute(pathname);
    if (!user && !authPage && !publicShareRoute) {
      router.replace("/login");
      return;
    }

    if (user && authPage) {
      router.replace("/");
    }
  }, [loading, pathname, router, user]);

  async function signIn(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return error;
  }

  async function signUp(email: string, password: string): Promise<AuthError | null> {
    const { error } = await supabase.auth.signUp({ email, password });
    return error;
  }

  async function signOut(): Promise<AuthError | null> {
    const { error } = await supabase.auth.signOut();
    return error;
  }

  async function signInWithOAuth(provider: OAuthProvider, nextPath = "/"): Promise<AuthError | null> {
    const safeNext = nextPath.startsWith("/") && !nextPath.startsWith("//") ? nextPath : "/";
    const redirectTo =
      typeof window === "undefined"
        ? undefined
        : `${window.location.origin}/auth/callback?next=${encodeURIComponent(safeNext)}`;

    const { error } = await supabase.auth.signInWithOAuth({
      provider,
      options: { redirectTo },
    });

    return error;
  }

  const value: AuthContextValue = {
    user,
    session,
    loading,
    signIn,
    signUp,
    signOut,
    signInWithOAuth,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }

  return context;
}
