import type { HTMLAttributes, ReactNode } from "react";
import { AlertIcon } from "./icons";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function Card({ className, ...rest }: HTMLAttributes<HTMLElement>) {
  return (
    <section
      className={cx("rounded-xl border border-border bg-surface shadow-card", className)}
      {...rest}
    />
  );
}

/** Placeholder sized like the final content so nothing shifts when data arrives. */
export function Skeleton({ className, ...rest }: HTMLAttributes<HTMLSpanElement>) {
  return <span aria-hidden="true" className={cx("skeleton block", className)} {...rest} />;
}

export function InlineError({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div
      role="alert"
      className={cx("flex flex-wrap items-center gap-3 text-sm text-fg", className)}
    >
      <AlertIcon className="text-down" />
      <span>{message}</span>
      {onRetry && (
        <button
          type="button"
          onClick={onRetry}
          className="rounded-md border border-border bg-surface-2 px-3 py-1.5 text-sm font-medium hover:border-muted"
        >
          Retry
        </button>
      )}
    </div>
  );
}

export type BadgeTone = "warn" | "info";

/** Non-blocking status pill (stale data, fallback source, paused updates). */
export function Badge({
  children,
  title,
  tone = "warn",
}: {
  children: ReactNode;
  title?: string;
  tone?: BadgeTone;
}) {
  return (
    <span
      title={title}
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        tone === "warn" ? "bg-warn-bg text-warn-text" : "bg-surface-2 text-muted",
      )}
    >
      {tone === "warn" && <AlertIcon size={12} />}
      {children}
    </span>
  );
}

export function VisuallyHidden({ children }: { children: ReactNode }) {
  return <span className="sr-only">{children}</span>;
}
