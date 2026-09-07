import type { ApolloError } from "@apollo/client";

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
    return (
      <div className="border border-bad-fg/30 bg-bad-bg px-4 py-3 text-sm text-bad-fg">
        Couldn’t load this data. {error.message}
      </div>
    );
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
