import type { NextConfig } from 'next';

const apiInternalUrl = process.env.API_INTERNAL_URL || 'http://localhost:4000';

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: '/api/v1/:path*',
        destination: `${apiInternalUrl}/api/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;

