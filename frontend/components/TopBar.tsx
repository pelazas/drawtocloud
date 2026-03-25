"use client";

import { FileCode, FolderOpen, Layout, Save, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import UserMenu from "@/components/UserMenu";

interface TopBarProps {
  user: User | null;
  onDescribeApp?: () => void;
  onTemplates?: () => void;
  onMyDesigns?: () => void;
  onAutoLayout?: () => void;
  onSave?: () => void;
  saveDisabled?: boolean;
  saving?: boolean;
  onGenerateTerraform?: () => void;
  onSignIn?: () => void;
}

export default function TopBar({
  user,
  onDescribeApp,
  onTemplates,
  onMyDesigns,
  onAutoLayout,
  onSave,
  saveDisabled = false,
  saving = false,
  onGenerateTerraform,
  onSignIn,
}: TopBarProps) {
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-700/80 bg-gray-800/90 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-100 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar";

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
            className={buttonClass}
          >
            <Sparkles size={14} />
            Describe your app
          </button>

          <button
            type="button"
            onClick={onTemplates}
            className={buttonClass}
          >
            Templates
          </button>

          <button
            type="button"
            onClick={onMyDesigns}
            className={buttonClass}
          >
            <FolderOpen size={14} />
            My Designs
          </button>

          <button
            type="button"
            onClick={onAutoLayout}
            className={buttonClass}
          >
            <Layout size={14} />
            Auto Layout
          </button>
        </div>

        <div className="flex items-center gap-3">
          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={saveDisabled || saving}
              className={`${buttonClass} disabled:cursor-not-allowed disabled:opacity-50`}
            >
              <Save size={14} />
              {saving ? "Saving..." : "Save"}
            </button>
          )}

          <button
            type="button"
            onClick={onGenerateTerraform}
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-4 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-white transition-colors whitespace-nowrap font-topbar"
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
