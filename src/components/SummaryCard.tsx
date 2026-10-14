import { Card, InlineError, Skeleton } from "./ui/primitives";

export const SUMMARY_ID = "chart-summary";

interface Props {
  text: string | null;
  loading: boolean;
  error?: boolean;
  onRetry?: () => void;
}

/** Plain-language summary; also the chart's text alternative (aria-describedby). */
export function SummaryCard({ text, loading, error, onRetry }: Props) {
  return (
    <Card className="p-4 md:p-5" aria-labelledby="summary-heading" data-testid="summary">
      <h2 id="summary-heading" className="text-xs font-semibold tracking-wide text-muted uppercase">
        Summary
      </h2>
      {text ? (
        <p id={SUMMARY_ID} aria-live="polite" className="mt-1.5 text-base leading-relaxed text-fg">
          {text}
        </p>
      ) : error && !loading ? (
        <InlineError
          className="mt-2"
          message="The summary needs price history, which could not be loaded."
          onRetry={onRetry}
        />
      ) : (
        <div id={SUMMARY_ID} className="mt-2 space-y-2" aria-busy="true">
          <Skeleton className="h-5 w-full" />
          <Skeleton className="h-5 w-4/5" />
        </div>
      )}
    </Card>
  );
}
