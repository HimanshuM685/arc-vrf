import type { NextConfig } from 'next'

const config: NextConfig = {
  transpilePackages: ['@arc-vrf/sdk'],
  turbopack: { resolveAlias: { '@base-org/account': './lib/no-base-account.ts' } },
}
export default config
