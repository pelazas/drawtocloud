import Link from "next/link";
import { ReactNode } from "react";

interface AuthCardProps {
  title: string;
  subtitle: string;
  error: string | null;
  children: ReactNode;
  socialActions?: ReactNode;
  footerPrompt: string;
  footerHref: string;
  footerLabel: string;
}

export default function AuthCard({
  title,
  subtitle,
  error,
  children,
  socialActions,
  footerPrompt,
  footerHref,
  footerLabel,
}: AuthCardProps) {
  return (
    <main className="min-h-screen bg-[radial-gradient(ellipse_at_50%_0%,rgb(15_23_42)_0%,rgb(2_4_12)_70%)] px-4 flex items-center justify-center">
      <section className="w-full max-w-md rounded-xl border border-gray-700 bg-gray-900 p-6 shadow-xl shadow-black/30">
        <h1 className="text-2xl font-medium tracking-tight text-white">{title}</h1>
        <p className="text-sm text-gray-400 mt-2">{subtitle}</p>

        {error && (
          <p className="mt-4 rounded-lg border border-red-900/60 bg-red-950/40 px-3 py-2 text-sm text-red-300">
            {error}
          </p>
        )}

        <div className="mt-6 space-y-4">
          {socialActions}
          {socialActions && <div className="h-px bg-gray-700" />}
          {children}
        </div>

        <p className="mt-6 text-sm text-gray-400">
          {footerPrompt}{" "}
          <Link href={footerHref} className="text-blue-400 hover:text-blue-300 transition-colors">
            {footerLabel}
          </Link>
        </p>
      </section>
    </main>
  );
}
