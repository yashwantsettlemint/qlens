import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

// Unit tests cover the pure logic in lib/ and server/ (no React, no Next).
export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["{lib,server,mock}/**/*.test.ts"],
    // server/hasura.test.ts needs a real JWT secret to mint/verify tokens
    // (production requires it be set; tests shouldn't rely on the dev default).
    env: { HASURA_GRAPHQL_JWT_SECRET: '{"type":"HS256","key":"test-jwt-signing-key-32chars-minimum"}' },
  },
});
