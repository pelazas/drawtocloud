"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { FormEvent, useEffect, useId, useState } from "react";

type SaveProjectModalProps = {
  open: boolean;
  saving: boolean;
  defaultName?: string;
  isRenaming?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
};

export default function SaveProjectModal({
  open,
  saving,
  defaultName = "",
  isRenaming = false,
  onSave,
  onClose,
}: SaveProjectModalProps) {
  const [name, setName] = useState("");
  const titleId = useId();

  useEffect(() => {
    setName(defaultName.trim());
  }, [defaultName, open]);

  const trimmedName = name.trim();

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving || !trimmedName) {
      return;
    }
    onSave(trimmedName);
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && !saving) {
      onClose();
    }
  };

  if (!open) {
    return null;
  }

  return (
    <Dialog.Root open={open} onOpenChange={handleOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <Dialog.Content
            aria-labelledby={titleId}
            onEscapeKeyDown={(event) => {
              if (saving) {
                event.preventDefault();
              }
            }}
            onPointerDownOutside={(event) => {
              if (saving) {
                event.preventDefault();
              }
            }}
            className="w-full max-w-md rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl"
          >
            <Dialog.Title id={titleId} className="text-lg font-semibold text-white">
              Save project
            </Dialog.Title>
            <p className="mt-1 text-sm text-gray-400">
              {isRenaming ? "Update your project name before saving." : "Choose a name for your new project."}
            </p>

            <form className="mt-4 space-y-4" onSubmit={handleSubmit}>
              <div>
                <label htmlFor="project-name" className="mb-1.5 block text-sm text-gray-400">
                  Project name
                </label>
                <input
                  id="project-name"
                  type="text"
                  autoFocus
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="My architecture design"
                  className="w-full rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 transition-colors focus:border-blue-500 focus:outline-none"
                />
              </div>

              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={saving}
                  className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm font-medium text-gray-200 transition-colors hover:bg-gray-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || !trimmedName}
                  className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {saving ? "Saving..." : "Save"}
                </button>
              </div>
            </form>
          </Dialog.Content>
        </div>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
