"use client"

import { ChatInterface } from "@/components/ChatInterface"
import { SidebarProvider } from "@/components/ui/sidebar"

export default function Home() {
  return (
    <div className="min-h-screen gradient-subtle text-foreground transition-all duration-300">
      <SidebarProvider defaultOpen={false}>
        <ChatInterface mode="standalone" />
      </SidebarProvider>
    </div>
  )
}
