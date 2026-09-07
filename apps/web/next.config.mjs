/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Import graphql/schema.graphql as a raw string (used by the mock schema).
    config.module.rules.push({ test: /\.graphql$/, type: "asset/source" });
    return config;
  },
};

export default nextConfig;
