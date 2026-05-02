"use client"

import { ChatInterface } from "@/components/ChatInterface"
import { SidebarProvider } from "@/components/ui/sidebar"
import { ConnectorProvider } from "@/hooks/useConnector"

export default function Home() {
  return (
    <div className="min-h-screen gradient-subtle text-foreground transition-all duration-300">
      <ConnectorProvider>
        <SidebarProvider defaultOpen={false}>
          <ChatInterface />
        </SidebarProvider>
      </ConnectorProvider>
    </div>
  )
}
