"use client";

import { profile } from "@/service/authService";
import { useAppSelector, useAppDispatch } from "@/store/hook";
import { logout, setToken, setUser } from "@/store/slices/authSlice";
import { jwtDecode } from "jwt-decode";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";
import Link from "next/link";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Button from "@mui/material/Button";
import Modal from "@mui/material/Modal";
import NoteEditor from "../common/components/noteEditor";
import Box from "@mui/material/Box";
import {
  createNote,
  updateNote,
  aiSearchNotes,
  AiSearchResponse,
} from "@/service/noteService";
import { addNote } from "@/store/slices/noteSlice";
import { modalStyle } from "../common/style/modal";
import { INote } from "../common/models/note";
import { NotesContext } from "../common/context/notesContext";
import { CircularProgress, TextField } from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import SearchRoundedIcon from "@mui/icons-material/SearchRounded";
import CloseRoundedIcon from "@mui/icons-material/CloseRounded";
import LaunchRoundedIcon from "@mui/icons-material/LaunchRounded";
import DescriptionOutlinedIcon from "@mui/icons-material/DescriptionOutlined";
import MenuBookRoundedIcon from "@mui/icons-material/MenuBookRounded";
import ReactMarkdown from "react-markdown";

const confidenceTone: Record<string, { label: string; classes: string }> = {
  high: {
    label: "High confidence",
    classes: "bg-emerald-50 text-emerald-700 ring-emerald-200",
  },
  medium: {
    label: "Medium confidence",
    classes: "bg-amber-50 text-amber-700 ring-amber-200",
  },
  low: {
    label: "Low confidence",
    classes: "bg-orange-50 text-orange-700 ring-orange-200",
  },
  not_found: {
    label: "Not found",
    classes: "bg-slate-100 text-slate-600 ring-slate-200",
  },
};

function buildSourceMeta(reference: AiSearchResponse["references"][number]) {
  if (reference.source_type === "file") {
    const pageLabel =
      typeof reference.source_page === "number"
        ? `, page ${reference.source_page}`
        : "";
    return `${reference.source_name ?? "Attachment"}${pageLabel}`;
  }
  return "Directly from note content";
}

let isFetchingProfile = false;

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [openProfileMenu, setOpenProfileMenu] = useState(false);
  const [openNoteModal, setOpenNoteModal] = useState(false);
  const [editNote, setEditNote] = useState<INote | null>(null);
  const [search, setSearch] = useState("");
  const [filteredNotes, setFilteredNotes] = useState<INote[]>([]);
  const [aiAnswer, setAiAnswer] = useState<AiSearchResponse | null>(null);
  const [isAiSearching, setIsAiSearching] = useState(false);
  const { user } = useAppSelector((state) => state.auth);
  const { notes } = useAppSelector((state) => state.note);
  const dispatch = useAppDispatch();
  const router = useRouter();

  const handleLogout = () => {
    router.push("/login");
    localStorage.removeItem("token");
    dispatch(logout());
  };

  useEffect(() => {
    const token = localStorage.getItem("token");
    if (!token) {
      router.push("/login");
      return;
    }

    const decoded = jwtDecode(token);
    const currentTime = Date.now() / 1000;
    if (decoded.exp && decoded.exp < currentTime) {
      localStorage.removeItem("token");
      dispatch(logout());
      router.push("/login");
      return;
    }

    dispatch(setToken(token));
    if (!user && !isFetchingProfile) {
      isFetchingProfile = true;
      void (async () => {
        try {
          const fetchedUser = await profile();
          dispatch(setUser(fetchedUser));
        } finally {
          isFetchingProfile = false;
        }
      })();
    }
  }, [dispatch, router, user]);

  useEffect(() => {
    setAiAnswer(null);
    if (search) {
      const filtered = notes.filter((note: INote) =>
        note.title.toLowerCase().includes(search.toLowerCase()),
      );
      setFilteredNotes(filtered);
    } else {
      setFilteredNotes(notes);
    }
  }, [search, notes]);

  useEffect(() => {
    if (!user) return;
    router.prefetch("/notes");
    router.prefetch("/profile");
  }, [router, user]);

  const openNote = (noteId: string) => {
    setOpenNoteModal(true);
    setEditNote(notes.find((note: INote) => note.id === noteId) ?? null);
  };

  async function handleAiSearch() {
    const query = search.trim();
    if (query.length <= 3) return;

    setAiAnswer(null);
    setIsAiSearching(true);
    try {
      const res = await aiSearchNotes(query);
      if (res) {
        setAiAnswer(res);
        const referencedNoteIds = res.references.map(
          (reference: AiSearchResponse["references"][number]) => reference.note_id,
        );
        const filtered = notes.filter((note: INote) =>
          referencedNoteIds.includes(note.id),
        );
        setFilteredNotes(filtered.length > 0 ? filtered : []);
        profile()
          .then((updatedUser) => dispatch(setUser(updatedUser)))
          .catch(() => {});
      }
    } catch (error) {
      console.error(error);
      setFilteredNotes(
        notes.filter((note: INote) =>
          note.title.toLowerCase().includes(query.toLowerCase()),
        ),
      );
    } finally {
      setIsAiSearching(false);
    }
  }

  const trimmedSearch = search.trim();
  const canRunAiSearch = trimmedSearch.length > 3 && !isAiSearching;
  const statusLabel = aiAnswer
    ? `${aiAnswer.references.length} source${aiAnswer.references.length === 1 ? "" : "s"} connected`
    : trimmedSearch
      ? `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} visible`
      : `${notes.length} note${notes.length === 1 ? "" : "s"} ready`;

  const confidence =
    (aiAnswer && confidenceTone[aiAnswer.confidence]) || confidenceTone.medium;

  return (
    <NotesContext.Provider
      value={{ openNote, filteredNotes, aiAnswer, isAiSearching }}
    >
      <style>{`
        @media (max-width: 400px) {
          .p-name { display: none; }
        }
        .reference-excerpt {
          display: -webkit-box;
          -webkit-line-clamp: 4;
          -webkit-box-orient: vertical;
          overflow: hidden;
        }
      `}</style>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.18),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_26%),linear-gradient(180deg,_#f8fbff_0%,_#f8fafc_48%,_#eef4ff_100%)]">
        {user && (
          <>
            <div className="px-4 pb-4 pt-4 sm:px-6">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <svg width="100" height="40" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
                    <text x="5" y="28" fill="currentColor" fontFamily="monospace, sans-serif" fontSize="24" fontWeight="900" letterSpacing="2" className="text-blue-600 drop-shadow-sm">
                      APKH
                    </text>
                  </svg>
                </div>
                <div className="flex items-center gap-2">
                  <div className="relative inline-block">
                    <button
                      className="flex items-center gap-2 rounded-2xl border border-white/60 bg-white/80 px-3.5 py-2 shadow-sm backdrop-blur transition-colors hover:bg-white"
                      onClick={() => setOpenProfileMenu(!openProfileMenu)}
                    >
                      <Avatar sx={{ bgcolor: "var(--color-blue-600)" }}>
                        {user.name.split(" ").map((word: string) => word[0])}
                      </Avatar>
                      <span className="p-name font-medium text-slate-700">{user.name}</span>
                    </button>
                    <div
                      className={`absolute right-0 z-50 mt-2 w-44 origin-top rounded-2xl bg-white shadow-lg transition-all duration-300 ${
                        openProfileMenu
                          ? "scale-y-100 border border-slate-200 opacity-100"
                          : "scale-y-0 border-0 opacity-0"
                      }`}
                    >
                      <Link href="/profile" className="block px-4 py-2 text-gray-800 hover:bg-gray-100" onClick={() => setOpenProfileMenu(false)}>
                        Profile
                      </Link>
                      <div className="cursor-pointer px-4 py-2 text-gray-800 hover:bg-gray-100" onClick={() => setOpenProfileMenu(false)}>
                        {user.type.toUpperCase()} (Upgrade)
                      </div>
                      <div className="cursor-pointer px-4 py-2 text-red-600 hover:bg-gray-100" onClick={handleLogout}>
                        Logout
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {/* Search panel */}
              <div className="overflow-hidden rounded-[24px] border border-sky-100/90 bg-white/85 shadow-[0_24px_80px_-48px_rgba(14,116,144,0.55)] backdrop-blur">
                <div className="border-b border-sky-100/80 bg-[linear-gradient(135deg,_rgba(240,249,255,0.95),_rgba(255,255,255,0.9)_55%,_rgba(239,246,255,0.92))] px-4 py-4 sm:px-5">
                  <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
                    <div className="max-w-2xl">
                      <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.22em] text-sky-700">
                        <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />
                        AI Search Workspace
                      </div>
                      <h1 className="mt-3 text-xl font-semibold tracking-tight text-slate-900 sm:text-2xl">
                        Ask across your notes and attachments
                      </h1>
                      <p className="mt-1.5 max-w-xl text-sm leading-6 text-slate-600">
                        Type to narrow notes instantly, then use AI to synthesize answers grounded in your saved notes, PDFs, and files.
                      </p>
                    </div>
                    <div className="w-full max-w-3xl xl:min-w-[500px]">
                      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
                        <TextField
                          id="search"
                          placeholder="Ask about a project, meeting, file, or concept..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); void handleAiSearch(); } }}
                          autoComplete="off"
                          variant="outlined"
                          className="w-full"
                          slotProps={{
                            input: {
                              startAdornment: (
                                <div className="mr-2 flex h-9 w-9 items-center justify-center rounded-xl bg-sky-100 text-sky-700">
                                  <SearchRoundedIcon fontSize="small" />
                                </div>
                              ),
                            },
                          }}
                          sx={{
                            "& .MuiOutlinedInput-root": {
                              minHeight: 54,
                              borderRadius: "18px",
                              backgroundColor: "rgba(255,255,255,0.96)",
                              paddingLeft: "6px",
                              boxShadow: "0 10px 40px -26px rgba(14,116,144,0.55)",
                              "& fieldset": { borderColor: "rgba(186,230,253,0.95)", borderWidth: "1px" },
                              "&:hover fieldset": { borderColor: "rgba(56,189,248,0.95)" },
                              "&.Mui-focused fieldset": { borderColor: "rgba(14,165,233,1)", borderWidth: "2px" },
                            },
                            "& .MuiInputBase-input": { fontSize: "0.95rem", color: "#0f172a" },
                          }}
                        />
                        <div className="flex gap-2 sm:justify-end">
                          <Button
                            variant="contained"
                            onClick={() => void handleAiSearch()}
                            disabled={!canRunAiSearch}
                            startIcon={isAiSearching ? <CircularProgress color="inherit" size={16} /> : <AutoAwesomeOutlinedIcon />}
                            sx={{
                              minHeight: 54, minWidth: 128, borderRadius: "18px", textTransform: "none",
                              fontWeight: 700, fontSize: "0.9rem",
                              boxShadow: "0 18px 35px -22px rgba(29,78,216,0.9)",
                              background: "linear-gradient(135deg, #0284c7 0%, #1d4ed8 100%)",
                              "&:hover": { background: "linear-gradient(135deg, #0369a1 0%, #1e40af 100%)" },
                            }}
                          >
                            {isAiSearching ? "Searching..." : "Ask AI"}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => { setSearch(""); setAiAnswer(null); }}
                            disabled={!search && !aiAnswer}
                            startIcon={<CloseRoundedIcon />}
                            sx={{
                              minHeight: 54, borderRadius: "18px", textTransform: "none",
                              fontWeight: 600, fontSize: "0.9rem",
                              borderColor: "rgba(186,230,253,0.95)", color: "#0369a1",
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>
                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">{statusLabel}</span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">Instant title filtering stays active while you type</span>
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">AI answers cite note and file sources</span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* AI Answer Panel - visible on every page */}
            {(isAiSearching || aiAnswer) && (
              <div className="px-4 sm:px-6">
                {isAiSearching && (
                  <div className="mb-8 overflow-hidden rounded-[30px] border border-sky-100 bg-white/90 shadow-[0_28px_80px_-52px_rgba(14,116,144,0.75)]">
                    <div className="grid gap-5 p-6 md:grid-cols-[auto_1fr] md:items-center">
                      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-sky-100 text-sky-700">
                        <CircularProgress size={26} />
                      </div>
                      <div>
                        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-sky-700">AI Search In Progress</p>
                        <h2 className="mt-2 text-2xl font-semibold tracking-tight text-slate-900">Reading across your notes and attachments</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">The assistant is grounding the answer with indexed note text, file excerpts, and the most relevant references it can find.</p>
                      </div>
                    </div>
                  </div>
                )}

                {aiAnswer && !isAiSearching && (
                  <div className="mb-8 overflow-hidden rounded-[32px] border border-sky-100 bg-[linear-gradient(160deg,_rgba(240,249,255,0.98),_rgba(255,255,255,0.96)_45%,_rgba(238,242,255,0.94)_100%)] shadow-[0_30px_90px_-56px_rgba(37,99,235,0.7)]">
                    <div className="border-b border-sky-100/90 px-6 py-6">
                      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                        <div className="max-w-2xl">
                          <div className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/90 px-3 py-1 text-xs font-semibold uppercase tracking-[0.24em] text-sky-700">
                            <AutoAwesomeOutlinedIcon sx={{ fontSize: 16 }} />
                            AI Answer Panel
                          </div>
                          <h2 className="mt-4 text-2xl font-semibold tracking-tight text-slate-900">{aiAnswer.query}</h2>
                          <p className="mt-2 text-sm leading-6 text-slate-600">This answer is grounded in your saved notes and attached files. Open any source card to jump straight into the note.</p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${confidence.classes}`}>{confidence.label}</span>
                          <span className="rounded-full bg-white/90 px-3 py-1 text-xs font-semibold text-slate-700 ring-1 ring-slate-200">
                            {aiAnswer.references.length} source{aiAnswer.references.length === 1 ? "" : "s"}
                          </span>
                        </div>
                      </div>
                    </div>
                    <div className="grid gap-6 p-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(320px,1fr)]">
                      <div className="rounded-[28px] border border-white/80 bg-white/88 p-5 shadow-[0_20px_60px_-48px_rgba(15,23,42,0.9)]">
                        <div className="mb-4 flex items-center gap-2 text-sky-700">
                          <AutoAwesomeOutlinedIcon />
                          <h3 className="text-lg font-semibold text-slate-900">Synthesized answer</h3>
                        </div>
                        <div className="prose prose-slate max-w-none text-slate-700">
                          <ReactMarkdown>{aiAnswer.answer}</ReactMarkdown>
                        </div>
                      </div>
                      <div className="space-y-3">
                        <div>
                          <h3 className="text-lg font-semibold text-slate-900">Source trail</h3>
                          <p className="text-sm text-slate-500">Click a source to open the matching note.</p>
                        </div>
                        {aiAnswer.references.length > 0 ? (
                          aiAnswer.references.map((reference: AiSearchResponse["references"][number], index: number) => (
                            <button
                              key={`${reference.note_id}-${reference.source_name ?? "note"}-${index}`}
                              onClick={() => openNote(reference.note_id)}
                              className="group w-full rounded-[24px] border border-slate-200 bg-white/92 p-4 text-left shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-sky-200 hover:shadow-[0_18px_35px_-28px_rgba(2,132,199,0.8)]"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2 text-sky-700">
                                    {reference.source_type === "file" ? (
                                      <DescriptionOutlinedIcon sx={{ fontSize: 18 }} />
                                    ) : (
                                      <MenuBookRoundedIcon sx={{ fontSize: 18 }} />
                                    )}
                                    <span className="text-xs font-semibold uppercase tracking-[0.24em]">
                                      {reference.source_type === "file" ? "Attachment source" : "Note source"}
                                    </span>
                                  </div>
                                  <h4 className="mt-3 text-base font-semibold text-slate-900">{reference.note_title}</h4>
                                  <p className="mt-1 text-sm text-slate-500">{buildSourceMeta(reference)}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                  <span className="rounded-full bg-sky-50 px-3 py-1 text-xs font-semibold text-sky-700 ring-1 ring-sky-100">
                                    {Math.round(reference.similarity_score * 100)}% match
                                  </span>
                                  <LaunchRoundedIcon className="text-slate-300 transition-colors group-hover:text-sky-600" />
                                </div>
                              </div>
                              <p className="reference-excerpt mt-4 text-sm leading-6 text-slate-600">{reference.excerpt}</p>
                            </button>
                          ))
                        ) : (
                          <div className="rounded-[24px] border border-dashed border-slate-300 bg-white/80 p-5 text-sm leading-6 text-slate-500">
                            No direct source excerpts were returned for this answer.
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div>{children}</div>

            <div className="fixed bottom-0 right-0 p-6">
              <Button
                color="primary"
                variant="contained"
                className="rounded-full! p-3!"
                aria-label="add note"
                onClick={() => { setOpenNoteModal(true); setEditNote(null); }}
              >
                <AddRoundedIcon />
              </Button>
            </div>

            <Modal open={openNoteModal} onClose={() => setOpenNoteModal(false)} aria-labelledby="modal-modal-title" aria-describedby="modal-modal-description">
              <Box sx={modalStyle()}>
                <NoteEditor
                  onSave={async (data, id) => {
                    let res: INote | null = null;
                    if (id) { res = await updateNote(id, data); } else { res = await createNote(data); }
                    if (res) dispatch(addNote(res));
                    setOpenNoteModal(false);
                  }}
                  initialNote={editNote}
                  categoryOptions={Array.from(new Set(notes.map((note: INote) => note.category)))}
                />
              </Box>
            </Modal>
          </>
        )}
      </div>
    </NotesContext.Provider>
  );
}