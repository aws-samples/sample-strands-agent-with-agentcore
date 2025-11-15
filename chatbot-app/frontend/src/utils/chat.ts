import { Calculator, Globe, Code, Image, UserCheck, Monitor, GitBranch, Cog } from 'lucide-react'

export const getToolIconById = (toolId: string) => {
  switch (toolId) {
    case 'calculator':
      return Calculator
    case 'http_request':
      return Globe
    case 'code_interpreter':
      return Code
    case 'generate_image':
      return Image
    case 'image_reader':
      return Image
    case 'handoff_to_user':
      return UserCheck
    case 'browser':
      return Monitor
    case 'diagram':
      return GitBranch
    default:
      return Cog
  }
}

export const getCategoryColor = (category: string) => {
  switch (category) {
    case 'utilities':
      return 'bg-blue-500/10 text-blue-600 border-blue-500/20'
    case 'web':
      return 'bg-green-500/10 text-green-600 border-green-500/20'
    case 'code':
      return 'bg-purple-500/10 text-purple-600 border-purple-500/20'
    case 'multimodal':
      return 'bg-orange-500/10 text-orange-600 border-orange-500/20'
    case 'workflow':
      return 'bg-pink-500/10 text-pink-600 border-pink-500/20'
    case 'visualization':
      return 'bg-indigo-500/10 text-indigo-600 border-indigo-500/20'
    default:
      return 'bg-gray-500/10 text-gray-600 border-gray-500/20'
  }
}


export const detectBackendUrl = async (): Promise<{ url: string; connected: boolean }> => {
  // New architecture: BFF is integrated into Next.js as API Routes
  // Always use relative paths to /api endpoints

  try {
    const response = await fetch('/api/health', {
      method: 'GET',
      signal: AbortSignal.timeout(5000)
    })

    if (response.ok) {
      const data = await response.json()
      if (data.status === 'healthy') {
        return { url: '', connected: true } // Empty URL means use relative paths
      }
    }
  } catch (error) {
    console.error('BFF health check failed:', error)
    return { url: '', connected: false }
  }

  return { url: '', connected: false }
}
