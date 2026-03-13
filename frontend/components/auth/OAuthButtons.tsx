"use client";

import { useState } from "react";
import { useAuth, type OAuthProvider } from "@/components/auth/AuthProvider";

interface Props {
  onError: (message: string | null) => void;
}

const providers: Array<{ key: OAuthProvider; label: string }> = [
  { key: "github", label: "Continue with GitHub" },
  { key: "google", label: "Continue with Google" },
];

export default function OAuthButtons({ onError }: Props) {
  const { signInWithOAuth } = useAuth();
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(null);

  if (process.env.NEXT_PUBLIC_ENABLE_SOCIAL_AUTH !== "true") {
    return null;
  }

  async function handleOAuth(provider: OAuthProvider) {
    onError(null);
    setLoadingProvider(provider);
    const error = await signInWithOAuth(provider);
    setLoadingProvider(null);

    if (error) {
      onError(error.message);
    }
  }

  return (
    <div className="space-y-2">
      {providers.map((provider) => (
        <button
          key={provider.key}
          type="button"
          onClick={() => void handleOAuth(provider.key)}
          disabled={loadingProvider !== null}
          className="w-full rounded-[10px] border border-gray-700 bg-gray-800 px-[18px] py-[12px] text-sm text-gray-100 hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {loadingProvider === provider.key ? "Redirecting..." : provider.label}
        </button>
      ))}
    </div>
  );
}
