"use client";

import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./ui/icons";
import { cx } from "./ui/primitives";

interface ModalProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** "sheet" docks to the bottom of the screen (mobile watchlist). */
  variant?: "center" | "sheet";
}

/** Native <dialog>: focus is trapped, Esc closes and focus returns to the trigger. */
export function Modal({ open, onClose, title, children, variant = "center" }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      if (typeof dialog.showModal === "function") dialog.showModal();
      else dialog.setAttribute("open", "");
    } else if (!open && dialog.open) {
      if (typeof dialog.close === "function") dialog.close();
      else dialog.removeAttribute("open");
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onClose={onClose}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
      className={cx(
        "border border-border bg-surface p-0 text-fg shadow-2xl",
        variant === "sheet"
          ? "fixed inset-x-0 top-auto bottom-0 m-0 max-h-[80vh] w-full max-w-full rounded-t-2xl"
          : "m-auto max-h-[85vh] w-[min(640px,calc(100vw-32px))] rounded-2xl",
      )}
    >
      <div className="sticky top-0 flex items-center justify-between border-b border-border bg-surface px-5 py-3">
        <h2 id={titleId} className="text-base font-semibold">
          {title}
        </h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
        >
          <CloseIcon size={18} />
        </button>
      </div>
      <div className="px-5 py-4">{children}</div>
    </dialog>
  );
}
