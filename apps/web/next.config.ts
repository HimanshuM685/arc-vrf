import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile at the repo root).
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@arc-vrf/sdk'],
  turbopack: { resolveAlias: { '@base-org/account': './lib/no-base-account.ts' } },
}
export default config
