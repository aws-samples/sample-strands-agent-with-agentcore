/**
 * Custom loading component for better UX
 */
export default function Loading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800">
      <div className="flex flex-col items-center gap-4">
        {/* Animated spinner */}
        <div className="relative h-16 w-16">
          <div className="absolute inset-0 rounded-full border-4 border-gray-200 dark:border-gray-700"></div>
          <div className="absolute inset-0 animate-spin rounded-full border-4 border-t-blue-500 border-r-transparent border-b-transparent border-l-transparent"></div>
        </div>

        {/* Loading text */}
        <div className="flex flex-col items-center gap-2">
          <p className="text-heading font-medium text-gray-700 dark:text-gray-300">
            Loading Agent...
          </p>
          <p className="text-label text-gray-500 dark:text-gray-400">
            Preparing your AI assistant
          </p>
        </div>
      </div>
    </div>
  )
}
