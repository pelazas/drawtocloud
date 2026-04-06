"use client";

import { FileCode, FolderOpen, Layout, Save, Settings, Sparkles } from "lucide-react";
import type { User } from "@supabase/supabase-js";
import UserMenu from "@/components/UserMenu";
import { shouldDisableGenerateTerraformButton } from "@/lib/canvasInteractionGuards";

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
  onSeeTerraformCode?: () => void;
  onSettings?: () => void;
  terraformButtonState: "generate" | "generating" | "view";
  onSignIn?: () => void;
  actionsDisabled?: boolean;
  quotaText?: string | null;
  hasArchitecture?: boolean;
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
  onSeeTerraformCode,
  onSettings,
  terraformButtonState,
  onSignIn,
  actionsDisabled = false,
  quotaText = null,
  hasArchitecture = true,
}: TopBarProps) {
  const buttonClass =
    "inline-flex items-center gap-1.5 rounded-xl border border-gray-700/80 bg-gray-800/90 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-gray-100 hover:bg-gray-700 transition-colors whitespace-nowrap font-topbar disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-gray-800/90";

  function renderTerraformButton() {
    const baseClass =
      "inline-flex items-center gap-1.5 rounded-xl px-4 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase transition-colors whitespace-nowrap font-topbar disabled:opacity-50 disabled:cursor-not-allowed";

    if (terraformButtonState === "view") {
      return (
        <button
          type="button"
          onClick={onSeeTerraformCode}
          disabled={actionsDisabled}
          className={`${baseClass} border border-gray-500 text-gray-200 hover:border-gray-400 hover:text-white`}
        >
          <FileCode size={14} />
          See Terraform Code
        </button>
      );
    }

    const generateDisabled = shouldDisableGenerateTerraformButton({
      actionsDisabled,
      terraformButtonState,
      hasArchitecture,
    });

    return (
      <button
        type="button"
        onClick={onGenerateTerraform}
        disabled={generateDisabled}
        className={`${baseClass} border border-gray-500 text-gray-200 hover:border-gray-400 hover:text-white`}
      >
        <FileCode size={14} />
        Generate Terraform
      </button>
    );
  }

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
            className="inline-flex items-center gap-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 px-3 py-2 text-[12px] font-semibold tracking-[0.08em] uppercase text-white transition-colors whitespace-nowrap font-topbar disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-blue-600"
          >
            <Sparkles size={14} />
            New Architecture
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

          {onSave && (
            <button
              type="button"
              onClick={onSave}
              disabled={actionsDisabled || saveDisabled || saving}
              className={buttonClass}
            >
              <Save size={14} />
              {saving ? "Saving..." : "Save"}
            </button>
          )}

          {renderTerraformButton()}

          {user && onSettings ? (
            <button
              type="button"
              onClick={onSettings}
              disabled={actionsDisabled}
              className={buttonClass}
              aria-label="AI provider settings"
            >
              <Settings size={14} />
            </button>
          ) : null}

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
