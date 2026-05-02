import { NextResponse } from 'next/server'
import skillsConfig from '@/config/skills-config.json'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json({ skills: skillsConfig })
}
