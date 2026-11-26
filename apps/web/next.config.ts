import type { NextConfig } from 'next';
import path from 'node:path';

const staticDemo = process.env.NEXT_PUBLIC_NEXUS_STATIC === '1';
const config: NextConfig = {
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  skipTrailingSlashRedirect: true,
  ...(staticDemo ? {
    output: 'export' as const,
    basePath: process.env.NEXT_PUBLIC_NEXUS_BASE_PATH || '',
    trailingSlash: true,
  } : process.env.NEXUS_STANDALONE === '1' ? {
    output: 'standalone' as const,
    outputFileTracingRoot: path.join(__dirname, '../..'),
  } : {}),
  ...(process.env.NEXUS_DIST ? { distDir: process.env.NEXUS_DIST } : {}),
  ...(!staticDemo ? {async rewrites() {
    const gateway = process.env.GATEWAY_URL || 'http://localhost:8080';
    return process.env.NEXUS_DEMO === '1' ? [] : [
      { source: '/api/:path*', destination: gateway + '/api/:path*' },
      { source: '/socket.io', destination: gateway + '/socket.io/' },
    ];
  }} : {}),
};

export default config;
