import type { ApolloError } from "@apollo/client";
import { Callout } from "./Callout";

/** Uniform loading / error rendering for a query-backed section. */
export function QueryState({
  loading,
  error,
  children,
  minRows = 3,
}: {
  loading: boolean;
  error?: ApolloError;
  children: React.ReactNode;
  minRows?: number;
}) {
  if (error) {
    return <Callout tone="bad">Couldn’t load this data. {error.message}</Callout>;
  }
  if (loading) {
    return (
      <div className="space-y-2" aria-busy="true">
        {Array.from({ length: minRows }).map((_, i) => (
          <div key={i} className="h-9 animate-pulse rounded bg-line/60" />
        ))}
      </div>
    );
  }
  return <>{children}</>;
}
