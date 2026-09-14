import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { ChatSidebar } from '@/components/ChatSidebar'
import { SidebarProvider } from '@/components/ui/sidebar'
import type { ChatSession } from '@/hooks/useChatSessions'

const state = vi.hoisted(() => ({
  sessions: [] as ChatSession[],
  deleteSession: vi.fn().mockResolvedValue(undefined),
  deleteAllSessions: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/hooks/useChatSessions', () => ({
  useChatSessions: () => ({
    chatSessions: state.sessions,
    isLoadingSessions: false,
    deleteSession: state.deleteSession,
    deleteAllSessions: state.deleteAllSessions,
  }),
}))
vi.mock('@/components/sidebar/ConnectorPanel', () => ({
  ConnectorPanel: () => <div>Connected tools</div>,
}))

const session = (sessionId: string, title: string): ChatSession => ({
  sessionId, title, createdAt: new Date().toISOString(),
  lastMessageAt: new Date().toISOString(), messageCount: 2, status: 'active',
})

function sidebar(onNewChat = vi.fn(), loadSession = vi.fn().mockResolvedValue(undefined)) {
  return <SidebarProvider><ChatSidebar sessionId="aws" onNewChat={onNewChat} loadSession={loadSession} /></SidebarProvider>
}

beforeEach(() => {
  vi.clearAllMocks()
  state.sessions = [session('aws', 'AWS 배포 계획'), session('design', '사이드바 디자인 검토')]
})

describe('ChatSidebar title search', () => {
  it('matches English without case sensitivity and Korean partial titles, keeping full titles', () => {
    render(sidebar())
    const input = screen.getByRole('textbox', { name: 'Search chat titles' })
    fireEvent.change(input, { target: { value: '  aWs  ' } })
    expect(screen.getByRole('button', { name: 'AWS 배포 계획' })).toHaveAttribute('aria-current', 'page')
    expect(screen.queryByRole('button', { name: '사이드바 디자인 검토' })).not.toBeInTheDocument()
    expect(screen.getByText('1 result')).toBeInTheDocument()
    expect(screen.queryByText('Today')).not.toBeInTheDocument()

    fireEvent.change(input, { target: { value: '디자인'.normalize('NFD') } })
    expect(screen.getByRole('button', { name: '사이드바 디자인 검토' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'AWS 배포 계획' })).not.toBeInTheDocument()
  })

  it('distinguishes no matches from no conversations and restores the list with focus', () => {
    render(sidebar())
    const input = screen.getByRole('textbox', { name: 'Search chat titles' })
    fireEvent.change(input, { target: { value: 'missing' } })
    expect(screen.getByText('No matching chats')).toBeInTheDocument()
    expect(screen.queryByText('No conversations yet')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show all chats' }))
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(screen.getByText('Today')).toBeInTheDocument()

    fireEvent.change(input, { target: { value: 'missing' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(input).toHaveValue('')
    expect(screen.queryByText('No matching chats')).not.toBeInTheDocument()
  })

  it('keeps the query when the session list refreshes and clears it for a new chat', () => {
    const onNewChat = vi.fn()
    const { rerender } = render(sidebar(onNewChat))
    const input = screen.getByRole('textbox', { name: 'Search chat titles' })
    fireEvent.change(input, { target: { value: 'AWS' } })
    state.sessions = [...state.sessions, session('new', 'AWS 비용 검토')]
    rerender(sidebar(onNewChat))
    expect(input).toHaveValue('AWS')
    expect(screen.getByText('2 results')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'New chat' }))
    expect(input).toHaveValue('')
    expect(onNewChat).toHaveBeenCalledOnce()
  })

  it('deletes the matching session without opening it or deleting all chats', async () => {
    const loadSession = vi.fn().mockResolvedValue(undefined)
    render(sidebar(vi.fn(), loadSession))
    fireEvent.change(screen.getByRole('textbox', { name: 'Search chat titles' }), { target: { value: '디자인' } })
    fireEvent.click(screen.getByRole('button', { name: 'Delete 사이드바 디자인 검토' }))
    await waitFor(() => expect(state.deleteSession).toHaveBeenCalledWith('design'))
    expect(loadSession).not.toHaveBeenCalled()
    expect(state.deleteAllSessions).not.toHaveBeenCalled()
  })
})
