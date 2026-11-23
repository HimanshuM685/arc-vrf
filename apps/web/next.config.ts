import { fileURLToPath } from 'node:url'
import type { NextConfig } from 'next'

const config: NextConfig = {
  // Self-contained server bundle for the Docker image (see Dockerfile at the repo root).
  output: 'standalone',
  outputFileTracingRoot: fileURLToPath(new URL('../../', import.meta.url)),
  transpilePackages: ['@arc-vrf/sdk'],
  turbopack: { resolveAlias: { '@base-org/account': './lib/no-base-account.ts' } },
  // The Playground was removed; send old links to the quick start instead of a 404. Temporary (307) so
  // browsers don't cache it if the path is reused.
  redirects: async () => [{ source: '/playground', destination: '/docs#subscription', permanent: false }],
}
export default config
