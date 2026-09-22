import nextConfig from "eslint-config-next";

/** @type {import('eslint').Linter.Config[]} */
const config = [
  { ignores: ["graphql/generated/**"] },
  ...nextConfig,
  { rules: { "@typescript-eslint/no-explicit-any": "off" } },
];

export default config;
