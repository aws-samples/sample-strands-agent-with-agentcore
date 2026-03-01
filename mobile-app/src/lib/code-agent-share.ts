import { File, Directory, Paths } from 'expo-file-system'
import * as Sharing from 'expo-sharing'
import { zip } from 'react-native-zip-archive'
import { apiGet } from './api-client'
import { ENDPOINTS } from './constants'

interface WorkspaceFile {
  relativePath: string
  presignedUrl: string
  size: number
}

interface WorkspaceDownloadResponse {
  files: WorkspaceFile[]
}

/**
 * Download code-agent workspace files, zip them, and open the native share sheet.
 */
export async function shareCodeAgentFiles(sessionId: string): Promise<void> {
  const response = await apiGet<WorkspaceDownloadResponse>(
    ENDPOINTS.codeAgentDownload(sessionId),
  )

  if (!response.files || response.files.length === 0) {
    throw new Error('No files found in workspace')
  }

  // Create temp directory (remove stale one if exists)
  const dirName = `code-agent-${Date.now()}`
  const tempDir = new Directory(Paths.cache, dirName)
  if (tempDir.exists) tempDir.delete()
  tempDir.create()

  // Create all subdirectories first (synchronously, to avoid race conditions)
  const createdDirs = new Set<string>()
  for (const file of response.files) {
    const parts = file.relativePath.split('/')
    if (parts.length > 1) {
      const dirPath = parts.slice(0, -1).join('/')
      if (!createdDirs.has(dirPath)) {
        const subDir = new Directory(tempDir, dirPath)
        if (!subDir.exists) subDir.create()
        createdDirs.add(dirPath)
      }
    }
  }

  // Download all files in parallel
  await Promise.all(
    response.files.map(async (file) => {
      const dest = new File(tempDir, file.relativePath)
      await File.downloadFileAsync(file.presignedUrl, dest)
    }),
  )

  // Zip the downloaded files
  const zipName = `code-agent-${sessionId.slice(0, 8)}.zip`
  const zipFile = new File(Paths.cache, zipName)
  if (zipFile.exists) zipFile.delete()
  await zip(tempDir.uri, zipFile.uri)

  // Share via native share sheet
  await Sharing.shareAsync(zipFile.uri, {
    mimeType: 'application/zip',
    dialogTitle: 'Share code files',
    UTI: 'public.zip-archive',
  })

  // Cleanup
  setTimeout(() => {
    try {
      if (tempDir.exists) tempDir.delete()
      if (zipFile.exists) zipFile.delete()
    } catch { /* ignore */ }
  }, 60_000)
}
