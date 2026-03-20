import { NextResponse } from 'next/server';

import { ENV_CONFIG } from '../../config/environment';

export async function GET() {
  return NextResponse.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    appversion: ENV_CONFIG.APP_VERSION
  });
}
