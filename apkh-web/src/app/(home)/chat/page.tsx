"use client";

import { useEffect, useState, useRef } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { 
    getChatMessages, 
    sendChatMessage, 
    deleteChatSession,
    IChatMessage
} from "@/service/chatService";
import { 
    setActiveSession, 
    setMessages, 
    addMessage, 
    removeSession,
    updateSessionTime
} from "@/store/slices/chatSlice";
import { CircularProgress, IconButton, Menu, MenuItem } from "@mui/material";
import AddIcon from '@mui/icons-material/Add';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import SendIcon from '@mui/icons-material/Send';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import Markdown from "react-markdown";

export default function ChatPage() {
  const dispatch = useAppDispatch();
  const { sessions, activeSessionId, messages, isLoading } = useAppSelector((state) => state.chat);
  
  const [inputValue, setInputValue] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [fetchingMessages, setFetchingMessages] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Read session ID from URL on mount
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const sessionParam = urlParams.get("session");
    if (sessionParam && sessionParam !== activeSessionId) {
      dispatch(setActiveSession(sessionParam));
      // Remove query param to clean URL without reloading route
      window.history.replaceState({}, '', '/chat');
    }
  }, [dispatch, activeSessionId]);

  // Load messages when active session changes
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (activeSessionId) {
        setFetchingMessages(true);
        try {
          const fetchedMessages = await getChatMessages(activeSessionId);
          if (mounted) {
            dispatch(setMessages(fetchedMessages));
          }
        } catch (err) {
          console.error("Failed to fetch messages for session", activeSessionId);
        } finally {
          if (mounted) setFetchingMessages(false);
        }
      } else {
        if (mounted) dispatch(setMessages([]));
      }
    })();
    return () => { mounted = false; };
  }, [activeSessionId, dispatch]);

  // Auto-scroll to bottom
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTo({
        top: scrollRef.current.scrollHeight,
        behavior: "smooth"
      });
    }
  }, [messages, isSending]);

  const handleSendMessage = async () => {
    if (!inputValue.trim() || !activeSessionId || isSending) return;
    
    const content = inputValue.trim();
    setInputValue("");
    
    // Optimistic UI for user message
    const tempId = `temp-${Date.now()}`;
    const userMsg: IChatMessage = {
        id: tempId,
        sessionId: activeSessionId,
        role: 'user',
        content,
        createdAt: new Date().toISOString()
    };
    dispatch(addMessage(userMsg));
    
    setIsSending(true);
    try {
        const response = await sendChatMessage(activeSessionId, content);
        
        // Dispatch actual answer
        const aiMsg: IChatMessage = {
            id: `ai-${Date.now()}`, // Temporary id for UI, db has correct one but not returned to save roundtrips
            sessionId: activeSessionId,
            role: 'assistant',
            content: response.answer,
            createdAt: new Date().toISOString()
        };
        dispatch(addMessage(aiMsg));
        dispatch(updateSessionTime(activeSessionId));
    } catch (err) {
        console.error("Failed to send message", err);
        // Remove optimistic message or show error...
    } finally {
        setIsSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleNewSession = () => {
     // A "New Session" is really just navigating to home to start an AI search which creates a session,
     // OR we could build a placeholder. Given the instructions, we can just redirect to Home for a new search.
     window.location.href = "/";
  };

  const currentSession = sessions.find(s => s.id === activeSessionId);

  return (
    <div className="flex h-[calc(100vh-80px)] w-full overflow-hidden bg-slate-50/50">
      {/* Sidebar */}
      <div className="flex w-80 flex-col border-r border-slate-200 bg-white/60">
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">History</h2>
          <button 
            onClick={handleNewSession}
            className="flex h-8 w-8 items-center justify-center rounded-full bg-sky-50 text-sky-600 transition hover:bg-sky-100"
            title="Start new search at Home"
          >
            <AddIcon fontSize="small" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          {sessions.length === 0 ? (
            <div className="mt-8 text-center text-sm text-slate-500">
              No chat history yet.
            </div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {sessions.map((session) => (
                <SessionItem 
                  key={session.id} 
                  session={session} 
                  isActive={activeSessionId === session.id} 
                  onClick={() => dispatch(setActiveSession(session.id))}
                  onDelete={async () => {
                    await deleteChatSession(session.id);
                    dispatch(removeSession(session.id));
                  }}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Main Chat Area */}
      <div className="flex flex-1 flex-col bg-white/40">
        {activeSessionId ? (
          <>
            {/* Header */}
            <div className="flex items-center justify-between border-b border-slate-200/60 bg-white/80 px-6 py-4 shadow-sm">
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-indigo-50 text-indigo-500">
                  <AutoAwesomeIcon fontSize="small" />
                </div>
                <div>
                  <h3 className="font-semibold text-slate-800">{currentSession?.title || "Conversation"}</h3>
                  <p className="text-xs text-slate-500">{currentSession?.messageCount} messages</p>
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-6 py-8" ref={scrollRef}>
              {fetchingMessages ? (
                <div className="flex h-full items-center justify-center">
                  <CircularProgress size={30} className="text-sky-500" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center text-center text-slate-500">
                    <AutoAwesomeIcon className="mb-4 text-slate-300" style={{ fontSize: 48 }} />
                    <p className="text-lg font-medium text-slate-600">Start the conversation</p>
                    <p className="text-sm">Your messages are powered by your knowledge base.</p>
                </div>
              ) : (
                <div className="flex flex-col gap-6">
                  {messages.map((msg, idx) => (
                    <MessageBubble key={msg.id || idx} message={msg} />
                  ))}
                  {isSending && (
                    <div className="flex w-full justify-start">
                      <div className="max-w-[75%] rounded-2xl rounded-tl-sm bg-white p-4 shadow-sm ring-1 ring-slate-100">
                        <div className="flex gap-1.5">
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300"></span>
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: "150ms" }}></span>
                            <span className="h-2 w-2 animate-bounce rounded-full bg-slate-300" style={{ animationDelay: "300ms" }}></span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Input Area */}
            <div className="border-t border-slate-200/60 bg-white/80 p-4 pb-6 px-6">
              <div className="mx-auto flex max-w-4xl items-end gap-3 rounded-[24px] bg-white p-2 pl-4 shadow-sm ring-1 ring-slate-200 focus-within:ring-2 focus-within:ring-sky-500">
                <textarea
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="Ask a follow-up question..."
                  className="max-h-32 min-h-[44px] w-full resize-none bg-transparent py-3 text-[15px] outline-none"
                  rows={Math.min(4, inputValue.split('\n').length)}
                />
                <button
                  onClick={handleSendMessage}
                  disabled={!inputValue.trim() || isSending}
                  className="mb-1 mr-1 flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-sky-500 text-white transition disabled:bg-slate-200 disabled:text-slate-400"
                >
                  <SendIcon fontSize="small" className={inputValue.trim() ? "translate-x-0.5" : ""} />
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex h-full flex-col items-center justify-center bg-slate-50/50">
            <div className="rounded-3xl border border-slate-200 bg-white p-10 text-center shadow-sm">
                <AutoAwesomeIcon className="mb-4 text-sky-400" style={{ fontSize: 40 }} />
                <h3 className="text-xl font-semibold text-slate-800">Your Chat History</h3>
                <p className="mt-2 text-slate-500 max-w-sm">
                    Select a conversation from the sidebar to pick up right where you left off, or start a new search from the home page.
                </p>
                <button 
                  onClick={handleNewSession}
                  className="mt-6 rounded-full bg-sky-600 px-6 py-2.5 text-sm font-semibold text-white shadow hover:bg-sky-700"
                >
                  Start New Search
                </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// --- Subcomponents ---

function SessionItem({ session, isActive, onClick, onDelete }: { session: any, isActive: boolean, onClick: () => void, onDelete: () => void }) {
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

  const handleMenuClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    event.stopPropagation();
    setAnchorEl(event.currentTarget);
  };

  const handleClose = (event?: React.MouseEvent) => {
    if(event) event.stopPropagation();
    setAnchorEl(null);
  };

  const handleDelete = (event: React.MouseEvent) => {
    event.stopPropagation();
    handleClose();
    onDelete();
  };

  const formattedDate = new Intl.DateTimeFormat('en-US', {
    month: 'short', day: 'numeric'
  }).format(new Date(session.updatedAt));

  return (
    <div 
      onClick={onClick}
      className={`group relative flex cursor-pointer items-center justify-between rounded-xl p-3 pr-2 transition ${
        isActive ? 'bg-sky-50 ring-1 ring-sky-200' : 'hover:bg-slate-100'
      }`}
    >
      <div className="min-w-0 flex-1">
        <h4 className={`truncate text-sm font-medium ${isActive ? 'text-sky-900' : 'text-slate-700'}`}>
          {session.title || "New Chat"}
        </h4>
        <p className="mt-0.5 truncate text-xs text-slate-400">{formattedDate}</p>
      </div>
      
      <div className={`opacity-0 transition group-hover:opacity-100 ${anchorEl ? 'opacity-100' : ''}`}>
        <IconButton size="small" onClick={handleMenuClick} className="text-slate-400 hover:text-slate-600">
          <MoreVertIcon fontSize="small" style={{ fontSize: 18 }} />
        </IconButton>
      </div>

      <Menu
        anchorEl={anchorEl}
        open={Boolean(anchorEl)}
        onClose={handleClose}
        transformOrigin={{ horizontal: 'right', vertical: 'top' }}
        anchorOrigin={{ horizontal: 'right', vertical: 'bottom' }}
        PaperProps={{
          style: { borderRadius: 12, boxShadow: '0 4px 20px rgba(0,0,0,0.08)', border: '1px solid #f1f5f9' },
        }}
      >
        <MenuItem onClick={handleDelete} className="text-red-500 hover:bg-red-50 gap-2 px-4 py-2">
          <DeleteOutlineIcon fontSize="small" /> <span className="text-sm font-medium">Delete</span>
        </MenuItem>
      </Menu>
    </div>
  );
}

function MessageBubble({ message }: { message: IChatMessage }) {
  const isUser = message.role === 'user';
  
  return (
    <div className={`flex w-full ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div 
        className={`max-w-[85%] sm:max-w-[75%] px-5 py-4 ${
          isUser 
            ? 'rounded-[22px] rounded-tr-sm bg-sky-600/95 text-white shadow-sm'
            : 'rounded-[22px] rounded-tl-sm bg-white text-slate-800 shadow-sm ring-1 ring-slate-100/50'
        }`}
      >
        {isUser ? (
          <p className="whitespace-pre-wrap text-[15px] leading-relaxed">{message.content}</p>
        ) : (
          <div className="note-rich-content">
            <Markdown>{message.content}</Markdown>
          </div>
        )}
      </div>
    </div>
  );
}
