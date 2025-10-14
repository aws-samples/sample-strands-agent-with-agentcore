/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  async headers() {
    return [
      {
        // Apply iframe-friendly headers to the embed route
        source: '/embed',
        headers: [
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN', // Allow embedding from same origin, will be overridden by CSP
          },
          {
            key: 'Content-Security-Policy',
            value: "frame-ancestors 'self' *", // Allow embedding from any domain for now
          },
        ],
      },
    ];
  },
  async rewrites() {
    const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

    return [
      {
        source: '/api/charts/:path*',
        destination: `${apiBaseUrl}/charts/:path*`
      },
      {
        source: '/api/files/:path*',
        destination: `${apiBaseUrl}/files/:path*`
      },
      {
        source: '/output/:path*',
        destination: `${apiBaseUrl}/output/:path*`
      },
      {
        source: '/uploads/:path*',
        destination: `${apiBaseUrl}/uploads/:path*`
      },
      {
        source: '/generated_images/:path*',
        destination: `${apiBaseUrl}/generated_images/:path*`
      }
    ]
  }
}

module.exports = nextConfig
