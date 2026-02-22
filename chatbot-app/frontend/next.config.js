const withBundleAnalyzer = require('@next/bundle-analyzer')({
  enabled: process.env.ANALYZE === 'true',
})

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',

  // Excalidraw uses browser APIs and must be transpiled for Next.js
  transpilePackages: ['@excalidraw/excalidraw'],

  // Remove console logs in production (keep error and warn)
  compiler: {
    removeConsole: process.env.NODE_ENV === 'production' ? {
      exclude: ['error', 'warn']
    } : false,
  },

  // Strict mode for better React warnings in development
  reactStrictMode: true,

  // Experimental optimizations
  experimental: {
    optimizePackageImports: ['lucide-react', 'recharts'],
  },

  async headers() {
    // Get allowed origins from environment variable (same as backend CORS_ORIGINS)
    // This ensures consistent security policy between frontend CSP and backend CORS
    const corsOrigins = process.env.CORS_ORIGINS || process.env.NEXT_PUBLIC_CORS_ORIGINS || 'http://localhost:3000';
    
    // Extract full origins from CORS configuration for CSP frame-ancestors
    // We use full origins (protocol + domain + port) for more precise control
    const allowedOrigins = corsOrigins
      .split(',')
      .map(origin => {
        try {
          const url = new URL(origin.trim());
          return url.origin;
        } catch {
          // If parsing fails, skip this origin
          console.warn(`Invalid CORS origin format: ${origin}`);
          return null;
        }
      })
      .filter(Boolean)
      .join(' ');
    
    // Build CSP frame-ancestors directive
    // 'self' allows same-origin embedding, then add configured origins
    const frameAncestors = allowedOrigins 
      ? `frame-ancestors 'self' ${allowedOrigins}`
      : "frame-ancestors 'self'";

    console.log(`CSP frame-ancestors: ${frameAncestors}`);

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
            value: frameAncestors,
          },
        ],
      },
    ];
  },
  async rewrites() {
    // Cloud mode: MEMORY_ID is set, no need for local AgentCore proxy
    // Local mode: proxy to local AgentCore for static files
    const isCloud = !!process.env.MEMORY_ID
    if (isCloud) {
      return []
    }

    // Local development: proxy to AgentCore Runtime
    const agentCoreUrl = process.env.NEXT_PUBLIC_AGENTCORE_URL || 'http://localhost:8080';

    return [
      {
        // Static files served by AgentCore
        source: '/output/:path*',
        destination: `${agentCoreUrl}/output/:path*`
      },
      {
        source: '/uploads/:path*',
        destination: `${agentCoreUrl}/uploads/:path*`
      },
      {
        source: '/generated_images/:path*',
        destination: `${agentCoreUrl}/generated_images/:path*`
      }
    ]
  }
}

module.exports = withBundleAnalyzer(nextConfig)
