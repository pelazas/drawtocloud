"use client";

import { FileCode, FolderOpen, Layout, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import UserMenu from "@/components/UserMenu";

interface TopBarProps {
  user: User | null;
  onDescribeApp?: () => void;
  onTemplates?: () => void;
  onMyDesigns?: () => void;
  onAutoLayout?: () => void;
  onGenerateTerraform?: () => void;
  onSignIn?: () => void;
  actionsDisabled?: boolean;
  quotaText?: string | null;
}

export default function TopBar({
  user,
  onDescribeApp,
  onTemplates,
  onMyDesigns,
  onAutoLayout,
  onGenerateTerraform,
  onSignIn,
  actionsDisabled = false,
  quotaText = null,
}: TopBarProps) {
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-700/80 bg-gray-800/90 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-100 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800/90";

  return (
    <div className="border-b border-gray-700 bg-gray-900 relative z-40">
      <div className="px-4 py-2 flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 overflow-x-auto">
          <h1 className="text-sm font-medium text-white pr-2 tracking-[0.02em]">
            draw<span className="font-black">to</span>cloud
          </h1>

          <button
            type="button"
            onClick={onDescribeApp}
            disabled={actionsDisabled}
            className={buttonClass}
          >
            <Sparkles size={14} />
            Describe your app
          </button>

          <button
            type="button"
            onClick={onTemplates}
            disabled={actionsDisabled}
            className={buttonClass}
          >
            Templates
          </button>

          <button
            type="button"
            onClick={onMyDesigns}
            disabled={actionsDisabled}
            className={buttonClass}
          >
            <FolderOpen size={14} />
            My Designs
          </button>

          <button
            type="button"
            onClick={onAutoLayout}
            disabled={actionsDisabled}
            className={buttonClass}
          >
            <Layout size={14} />
            Auto Layout
          </button>
        </div>

        <div className="flex items-center gap-3">
          {user && quotaText ? (
            <span className="text-xs font-medium text-blue-200 whitespace-nowrap">{quotaText}</span>
          ) : null}

          <button
            type="button"
            onClick={onGenerateTerraform}
            disabled={actionsDisabled}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-white transition-colors whitespace-nowrap font-topbar disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-blue-600"
          >
            <FileCode size={14} />
            Generate Terraform
          </button>

          {user ? (
            <UserMenu />
          ) : (
            <button
              type="button"
              onClick={onSignIn}
              className="inline-flex items-center rounded-xl border border-gray-700 bg-gray-800 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-200 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar"
            >
              Sign In
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
