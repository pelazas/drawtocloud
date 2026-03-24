"use client";

import { Suspense, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import OAuthButtons from "@/components/auth/OAuthButtons";

function safeNextPath(next: string | null): string {
  if (!next) return "/";
  if (!next.startsWith("/")) return "/";
  if (next.startsWith("//")) return "/";
  return next;
}

function LoginContent() {
  const searchParams = useSearchParams();
  const [error, setError] = useState<string | null>(null);

  const oauthError = searchParams.get("error");
  const nextPath = useMemo(() => safeNextPath(searchParams.get("next")), [searchParams]);

  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_50%_0%,rgb(15_23_42)_0%,rgb(2_4_12)_70%)] px-4 flex items-center justify-center">
      <section className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl shadow-black/30 text-center">
        <h1 className="text-2xl font-medium tracking-tight text-white">DrawToCloud</h1>
        <p className="text-sm text-gray-400 mt-2">Sign in to start designing your cloud architecture</p>

        {(error || oauthError) && (
          <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error ?? "OAuth sign-in failed. Please try again."}
          </p>
        )}

        <div className="mt-6">
          <OAuthButtons onError={setError} nextPath={nextPath} />
        </div>
      </section>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[radial-gradient(ellipse_at_50%_0%,rgb(15_23_42)_0%,rgb(2_4_12)_70%)] px-4 flex items-center justify-center">
          <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
        </main>
      }
    >
      <LoginContent />
    </Suspense>
  );
}
