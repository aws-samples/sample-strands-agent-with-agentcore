'use client';

import React, { useState, useEffect, useMemo, useRef, useId } from 'react';
import { Menu, Plus, Trash2, Moon, Sun, Settings, MoreHorizontal, Search, X, LogOut, Type, Plug } from 'lucide-react';
import { FaGithub } from 'react-icons/fa';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  useSidebar,
} from '@/components/ui/sidebar';
import { ChatSessionList } from './sidebar/ChatSessionList';
import { ConnectorPanel } from './sidebar/ConnectorPanel';
import { useChatSessions } from '@/hooks/useChatSessions';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useFontSize, FontSize } from '@/components/FontSizeProvider';

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
  const { toggleSidebar, setOpenMobile } = useSidebar();
  const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isMounted, setIsMounted] = useState(false);
  const [showSignOut, setShowSignOut] = useState(false);
  const [showConnector, setShowConnector] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchHintId = useId();

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

  const { fontSize, setFontSize } = useFontSize();

  // Use custom hooks
  const { chatSessions, isLoadingSessions, deleteSession, deleteAllSessions } = useChatSessions({
    sessionId,
    onNewChat,
  });

  const normalizedQuery = searchQuery.trim().normalize('NFC').toLowerCase();
  const filteredSessions = useMemo(() => chatSessions.filter(session =>
    session.title.normalize('NFC').toLowerCase().includes(normalizedQuery)
  ), [chatSessions, normalizedQuery]);

  const clearSearch = () => {
    setSearchQuery('');
    searchInputRef.current?.focus();
  };

  const handleNewChat = () => {
    setSearchQuery('');
    setShowConnector(false);
    setOpenMobile(false);
    onNewChat();
  };

  const handleLoadSession = loadSession ? async (id: string) => {
    await loadSession(id);
    setOpenMobile(false);
  } : undefined;

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
      className="bg-sidebar-background border-sidebar-border text-sidebar-foreground flex flex-col h-full"
    >
      {/* Header - Hamburger menu & Theme toggle */}
      <SidebarHeader className="flex-shrink-0 px-3 py-3 border-b-0">
        <div className="flex flex-row items-center justify-between">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleSidebar}
            className="h-9 w-9 p-0 hover:bg-sidebar-accent"
            title="Close sidebar"
            aria-label="Close sidebar"
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
              aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme === 'dark' ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
            </Button>
          )}
        </div>
      </SidebarHeader>

      {/* New Chat + Connectors Buttons */}
      <div className="px-3 pb-2 space-y-1">
        <Button
          variant="ghost"
          onClick={handleNewChat}
          className="w-full justify-start gap-3 h-10 px-3 border border-sidebar-border bg-sidebar-accent/50 hover:bg-sidebar-accent text-sidebar-foreground"
        >
          <Plus className="h-5 w-5" />
          <span className="text-[14px] font-medium">New chat</span>
        </Button>
        <Button
          variant="ghost"
          onClick={() => setShowConnector(!showConnector)}
          aria-expanded={showConnector}
          className={`w-full justify-start gap-3 h-10 px-3 hover:bg-sidebar-accent text-sidebar-foreground/70 ${showConnector ? 'bg-sidebar-accent text-sidebar-foreground' : ''}`}
        >
          <Plug className="h-4 w-4" />
          <span className="text-[14px]">Tools & apps</span>
        </Button>
      </div>

      {/* Connector Panel or Chats Section */}
      {showConnector ? (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <ConnectorPanel onBack={() => setShowConnector(false)} />
        </div>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
          <div className="px-3 pt-2 pb-3 flex-shrink-0">
            <div className="relative">
              <Search aria-hidden="true" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-sidebar-foreground/50" />
              <Input
                ref={searchInputRef}
                aria-label="Search chat titles"
                aria-describedby={searchHintId}
                placeholder="Search chat titles…"
                value={searchQuery}
                onChange={event => setSearchQuery(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Escape' && searchQuery) {
                    event.preventDefault();
                    event.stopPropagation();
                    clearSearch();
                  }
                }}
                className="h-9 pl-9 pr-9 text-[16px] md:text-[13px] bg-sidebar-background border-sidebar-border focus-visible:ring-1 focus-visible:ring-offset-0"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={clearSearch}
                  aria-label="Clear search"
                  className="absolute right-0.5 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-md text-sidebar-foreground/60 hover:bg-sidebar-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <X aria-hidden="true" className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <p id={searchHintId} className="mt-1.5 px-1 text-[11px] text-sidebar-foreground/60">
              Searches titles in this list · up to 100 chats
            </p>
          </div>
          <div className="px-4 pb-1 flex-shrink-0 flex min-h-8 items-center justify-between">
            <span className="text-[12px] font-medium text-sidebar-foreground/65" role="status">
              {normalizedQuery && !isLoadingSessions
                ? `${filteredSessions.length} ${filteredSessions.length === 1 ? 'result' : 'results'}`
                : 'Chats'}
            </span>
            {chatSessions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="sm" aria-label="Chat options" className="h-8 w-8 p-0 text-sidebar-foreground/60 hover:bg-sidebar-accent">
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setIsConfirmDialogOpen(true)} className="text-destructive focus:text-destructive">
                    <Trash2 className="h-4 w-4" />
                    Clear all chats…
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
          {/* Constrain Radix's intrinsic-width wrapper so long titles truncate inside the sidebar. */}
          <ScrollArea key={normalizedQuery} className="flex-1 min-h-0" viewportClassName="[&>div]:!block">
            <ChatSessionList
              sessions={filteredSessions}
              isSearching={!!normalizedQuery}
              onClearSearch={clearSearch}
              currentSessionId={sessionId}
              isLoading={isLoadingSessions}
              onLoadSession={handleLoadSession}
              onDeleteSession={deleteSession}
            />
          </ScrollArea>
        </div>
      )}

      {/* Settings Menu - Bottom */}
      <div className="flex-shrink-0 px-3 py-3 border-t border-sidebar-border">
        <Popover>
          <PopoverTrigger asChild>
            <Button
              variant="ghost"
              className="w-full justify-start gap-3 h-10 px-3 hover:bg-sidebar-accent text-sidebar-foreground/70"
            >
              <Settings className="h-4 w-4" />
              <span className="text-[13px]">Settings</span>
            </Button>
          </PopoverTrigger>
          <PopoverContent
            side="right"
            align="end"
            className="w-52 p-1.5"
            sideOffset={8}
          >
            <div className="px-3 py-2">
              <div className="flex items-center gap-2 mb-2">
                <Type className="h-3.5 w-3.5 text-muted-foreground" />
                <span className="text-xs font-medium text-muted-foreground">Font Size</span>
              </div>
              <div className="flex gap-1 rounded-md bg-muted p-0.5">
                {(['small', 'medium', 'large'] as FontSize[]).map((size) => (
                  <button
                    key={size}
                    onClick={() => setFontSize(size)}
                    className={`flex-1 px-2 py-1 text-xs rounded-sm transition-colors capitalize ${
                      fontSize === size
                        ? 'bg-background text-foreground shadow-xs font-medium'
                        : 'text-muted-foreground hover:text-foreground'
                    }`}
                  >
                    {size === 'small' ? 'S' : size === 'medium' ? 'M' : 'L'}
                  </button>
                ))}
              </div>
            </div>
            <div className="my-1 border-t border-border" />
            <a
              href={GITHUB_REPO_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full flex items-center gap-3 px-3 py-2 text-sm rounded-md hover:bg-muted transition-colors"
            >
              <FaGithub className="h-4 w-4 text-muted-foreground" />
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
