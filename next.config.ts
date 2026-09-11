import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["better-sqlite3"],
  // Next's file tracer only follows static imports. mizan.db (seeded at build
  // time by "vercel-build") and schema.sql are opened via a runtime-built
  // path in src/lib/db/index.ts, so they'd otherwise be silently dropped from
  // the serverless bundle — every request would then open an empty database.
  outputFileTracingIncludes: {
    "/**": ["mizan.db", "src/lib/db/schema.sql"],
  },
};

export default nextConfig;
