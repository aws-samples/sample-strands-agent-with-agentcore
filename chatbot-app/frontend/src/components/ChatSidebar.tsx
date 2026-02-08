'use client';

import React, { useState, useEffect } from 'react';
import { Menu, Plus, Trash2, Moon, Sun, Settings, KeyRound, Github, ChevronRight, LogOut } from 'lucide-react';
import { SettingsDialog } from './settings/SettingsDialog';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import {
  Sidebar,
  SidebarHeader,
  SidebarMenu,
  useSidebar,
} from '@/components/ui/sidebar';
import { ChatSessionList } from './sidebar/ChatSessionList';
import { useChatSessions } from '@/hooks/useChatSessions';
import { ScrollArea } from '@/components/ui/scroll-area';

const GITHUB_REPO_URL = 'https://github.com/aws-samples/sample-strands-agent-with-agentcore';

interface ChatSidebarProps {
  sessionId: string | null;
  onNewChat: () => void;
  loadSession?: (sessionId: string) => Promise<void>;
  theme?: string;
  setTheme?: (theme: string) => void;
}

export function ChatSidebar({
  sessionId,
  onNewChat,
  loadSession,
  theme,
  setTheme,
}: ChatSidebarProps) {
  const { toggleSidebar } = useSidebar();
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);

  // Prevent hydration mismatch by only rendering theme-dependent UI after mount
  useEffect(() => {
    setIsMounted(true);
    // Show sign-out only when Cognito is configured and not local dev
    const hasCognito = !!(process.env.NEXT_PUBLIC_COGNITO_USER_POOL_ID && process.env.NEXT_PUBLIC_COGNITO_USER_POOL_CLIENT_ID);
    const isLocal = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1';
    setShowSignOut(hasCognito && !isLocal);
  }, []);

  const handleSignOut = async () => {
    try {
      const { signOut } = await import('aws-amplify/auth');
      await signOut();
    } catch (error) {
      console.error('Sign out failed:', error);
    }
  };

  // Use custom hooks
  const { chatSessions, isLoadingSessions, deleteSession, deleteAllSessions } = useChatSessions({
    sessionId,
    onNewChat,
  });

  const handleClearAll = async () => {
    setIsDeleting(true);
    try {
      await deleteAllSessions();
      setIsConfirmDialogOpen(false);
    } catch (error) {
      alert('Failed to clear all chats. Please try again.');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <Sidebar
      side="left"
      className="group-data-[side=left]:border-r-0 bg-sidebar-background border-sidebar-border text-sidebar-foreground flex flex-col h-full"
    >
      {/* Header - Hamburger menu & Theme toggle */}
      <SidebarHeader className="flex-shrink-0 px-3 py-3 border-b-0">
        <SidebarMenu>
          <div className="flex flex-row items-center justify-between">
            <Button
              variant="ghost"
              size="sm"
              onClick={toggleSidebar}
              className="h-9 w-9 p-0 hover:bg-sidebar-accent"
              title="Close sidebar"
            >
              <Menu className="h-5 w-5" />
            </Button>
            {isMounted && theme && setTheme && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
                className="h-9 w-9 p-0 hover:bg-sidebar-accent"
                title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              >
                {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>
            )}
          </div>
        </SidebarMenu>
      </SidebarHeader>

      {/* New Chat Button */}
      <div className="px-3 pb-4">
        <Button
          variant="ghost"
          onClick={onNewChat}
          className="w-full justify-start gap-3 h-11 px-3 hover:bg-sidebar-accent text-sidebar-foreground"
        >
          <Plus className="h-5 w-5" />
          <span className="text-[15px] font-medium">New chat</span>
        </Button>
      </div>

      {/* Chats Section */}
      <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
        <div className="px-4 pb-2 flex-shrink-0 flex items-center justify-between">
          <span className="text-[13px] font-medium text-sidebar-foreground/60 uppercase tracking-wide">Chats</span>
          {chatSessions.length > 0 && (
            <button
              onClick={() => setIsConfirmDialogOpen(true)}
              className="text-sidebar-foreground/40 hover:text-destructive transition-colors"
              title="Clear all chats"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        <ScrollArea className="flex-1">
          <ChatSessionList
            sessions={chatSessions}
            currentSessionId={sessionId}
            isLoading={isLoadingSessions}
            onLoadSession={loadSession}
            onDeleteSession={deleteSession}
          />
        </ScrollArea>
      </div>

      {/* Settings Menu - Bottom */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-sidebar-border">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-end gap-2 h-10 px-3 hover:bg-sidebar-accent text-sidebar-foreground/70"
            >
              <span className="text-[13px]">Settings</span>
              <Settings className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="end"
            className="w-44 p-1"
            sideOffset={8}
          >
            <button
              onClick={() => setIsSettingsOpen(true)}
              className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              <KeyRound className="h-4 w-4 text-muted-foreground" />
              <span>API Keys</span>
            </button>
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              <Github className="h-4 w-4 text-muted-foreground" />
              <span>GitHub</span>
            </a>
            {showSignOut && (
              <>
                <div className="my-1 border-t border-border" />
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md hover:bg-destructive/10 text-destructive transition-colors"
                >
                  <LogOut className="h-4 w-4" />
                  <span>Sign out</span>
                </button>
              </>
            )}
          </PopoverContent>
        </Popover>
      </div>

      {/* Settings Dialog */}
      <SettingsDialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen} />

      {/* Clear All Confirmation Dialog */}
      <Dialog open={isConfirmDialogOpen} onOpenChange={setIsConfirmDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Clear all chats?</DialogTitle>
            <DialogDescription>
              This will permanently delete all your chat sessions. This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setIsConfirmDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleClearAll}
              disabled={isDeleting}
            >
              {isDeleting ? 'Deleting...' : 'Delete all'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Sidebar>
  );
}
