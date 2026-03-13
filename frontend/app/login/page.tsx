"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import { Eye, EyeOff } from "lucide-react";
import AuthCard from "@/components/auth/AuthCard";
import OAuthButtons from "@/components/auth/OAuthButtons";
import { useAuth } from "@/components/auth/useAuth";

export default function LoginPage() {
  const { signIn } = useAuth();
  const router = useRouter();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError("Please enter both email and password.");
      return;
    }

    setIsSubmitting(true);
    const authError = await signIn(email.trim(), password);
    setIsSubmitting(false);

    if (authError) {
      setError(authError.message);
      return;
    }

    router.replace("/");
  }

  return (
    <AuthCard
      title="Welcome back"
      subtitle="Sign in to continue building your architecture."
      error={error}
      socialActions={<OAuthButtons onError={setError} />}
      footerPrompt="New to DrawToCloud?"
      footerHref="/register"
      footerLabel="Create an account"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="block text-sm text-gray-300">
          Email
          <input
            type="email"
            autoComplete="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            className="mt-1 w-full rounded-[10px] border border-[rgb(40_40_50)] bg-[rgb(15_15_20)] px-[18px] py-[14px] text-[15px] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
            placeholder="you@company.com"
          />
        </label>

        <label className="block text-sm text-gray-300">
          Password
          <div className="relative mt-1">
            <input
              type={showPassword ? "text" : "password"}
              autoComplete="current-password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className="w-full rounded-[10px] border border-[rgb(40_40_50)] bg-[rgb(15_15_20)] px-[18px] py-[14px] pr-12 text-[15px] text-white placeholder-gray-600 focus:outline-none focus:border-blue-500 transition-colors"
              placeholder="Your password"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-200 transition-colors"
              aria-label={showPassword ? "Hide password" : "Show password"}
            >
              {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>
        </label>

        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed px-6 py-[11px] text-white text-sm transition-colors"
        >
          {isSubmitting ? "Signing in..." : "Sign in"}
        </button>
      </form>
    </AuthCard>
  );
}
