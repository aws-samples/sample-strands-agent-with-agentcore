"use client"

import { ChatInterface } from "@/components/ChatInterface"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function EmbedPage() {
  return (
    <div className="h-screen gradient-subtle text-foreground transition-all duration-300">
      <SidebarProvider defaultOpen={false}>
        <ChatInterface mode="embedded" />
      </SidebarProvider>
    </div>
  )
}
