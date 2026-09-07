"use client";

import { ApolloProvider } from "@apollo/client";
import { getClient } from "@/lib/apollo";
import { RoleProvider } from "@/lib/role";
import { AskProvider } from "@/components/ask/AskContext";

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <ApolloProvider client={getClient()}>
      <RoleProvider>
        <AskProvider>{children}</AskProvider>
      </RoleProvider>
    </ApolloProvider>
  );
}
