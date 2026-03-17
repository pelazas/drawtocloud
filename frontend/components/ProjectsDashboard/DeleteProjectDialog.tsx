"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { Loader2 } from "lucide-react";

type Props = {
  open: boolean;
  projectTitle: string;
  isDeleting: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DeleteProjectDialog({
  open,
  projectTitle,
  isDeleting,
  onConfirm,
  onCancel,
}: Props) {
  return (
    <Dialog.Root open={open} onOpenChange={(next) => { if (!next && !isDeleting) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 z-50 w-full max-w-sm -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-gray-700 bg-gray-900 p-6 shadow-2xl data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
          onEscapeKeyDown={(e) => { if (isDeleting) e.preventDefault(); }}
          onInteractOutside={(e) => { if (isDeleting) e.preventDefault(); }}
        >
          <Dialog.Title className="mb-1 text-base font-semibold text-white">
            Delete project?
          </Dialog.Title>
          <Dialog.Description className="mb-6 text-sm text-gray-400">
            <span className="font-medium text-gray-200">{projectTitle}</span> and all its data
            (diagram, Terraform files, cost estimate) will be permanently deleted. This cannot be
            undone.
          </Dialog.Description>

          <div className="flex justify-end gap-3">
            <button
              type="button"
              onClick={onCancel}
              disabled={isDeleting}
              className="rounded-lg border border-gray-700 bg-gray-800 px-4 py-2 text-sm text-gray-300 transition-colors hover:border-gray-600 hover:text-white disabled:pointer-events-none disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onConfirm}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-500 disabled:pointer-events-none disabled:opacity-70"
            >
              {isDeleting && <Loader2 size={14} className="animate-spin" />}
              {isDeleting ? "Deleting…" : "Delete"}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
