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
      const filtered = notes.filter((note) =>
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
    setEditNote(notes.find((note) => note.id === noteId) ?? null);
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
          (reference) => reference.note_id,
        );
        const filtered = notes.filter((note) =>
          referencedNoteIds.includes(note.id),
        );
        setFilteredNotes(filtered.length > 0 ? filtered : []);
      }
    } catch (error) {
      console.error(error);
      setFilteredNotes(
        notes.filter((note) =>
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
    ? `${aiAnswer.references.length} source${
        aiAnswer.references.length === 1 ? "" : "s"
      } connected`
    : trimmedSearch
      ? `${filteredNotes.length} note${filteredNotes.length === 1 ? "" : "s"} visible`
      : `${notes.length} note${notes.length === 1 ? "" : "s"} ready`;

  return (
    <NotesContext.Provider
      value={{ openNote, filteredNotes, aiAnswer, isAiSearching }}
    >
      <style>{`
        @media (max-width: 400px) {
          .p-name {
            display: none;
          }
        }
      `}</style>
      <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(125,211,252,0.18),_transparent_32%),radial-gradient(circle_at_top_right,_rgba(59,130,246,0.14),_transparent_26%),linear-gradient(180deg,_#f8fbff_0%,_#f8fafc_48%,_#eef4ff_100%)]">
        {user && (
          <>
            <div className="px-4 pb-4 pt-4 sm:px-6">
              <div className="mb-3 flex items-start justify-between gap-4">
                <div>
                  <svg
                    width="100"
                    height="40"
                    viewBox="0 0 100 40"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <text
                      x="5"
                      y="28"
                      fill="currentColor"
                      fontFamily="monospace, sans-serif"
                      fontSize="24"
                      fontWeight="900"
                      letterSpacing="2"
                      className="text-blue-600 drop-shadow-sm"
                    >
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
                        {user.name.split(" ").map((word) => word[0])}
                      </Avatar>
                      <span className="p-name font-medium text-slate-700">
                        {user.name}
                      </span>
                    </button>

                    <div
                      className={`absolute right-0 z-50 mt-2 w-44 origin-top rounded-2xl bg-white shadow-lg transition-all duration-300 ${
                        openProfileMenu
                          ? "scale-y-100 border border-slate-200 opacity-100"
                          : "scale-y-0 border-0 opacity-0"
                      }`}
                    >
                      <Link
                        href="/profile"
                        className="block px-4 py-2 text-gray-800 hover:bg-gray-100"
                        onClick={() => setOpenProfileMenu(false)}
                      >
                        Profile
                      </Link>
                      <div
                        className="cursor-pointer px-4 py-2 text-gray-800 hover:bg-gray-100"
                        onClick={() => setOpenProfileMenu(false)}
                      >
                        {user.type.toUpperCase()} (Upgrade)
                      </div>
                      <div
                        className="cursor-pointer px-4 py-2 text-red-600 hover:bg-gray-100"
                        onClick={handleLogout}
                      >
                        Logout
                      </div>
                    </div>
                  </div>
                </div>
              </div>

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
                        Type to narrow notes instantly, then use AI to
                        synthesize answers grounded in your saved notes, PDFs,
                        and files.
                      </p>
                    </div>

                    <div className="w-full max-w-3xl xl:min-w-[500px]">
                      <div className="flex flex-col gap-2.5 md:flex-row md:items-center">
                        <TextField
                          id="search"
                          placeholder="Ask about a project, meeting, file, or concept..."
                          value={search}
                          onChange={(e) => setSearch(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === "Enter") {
                              e.preventDefault();
                              void handleAiSearch();
                            }
                          }}
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
                              boxShadow:
                                "0 10px 40px -26px rgba(14,116,144,0.55)",
                              "& fieldset": {
                                borderColor: "rgba(186,230,253,0.95)",
                                borderWidth: "1px",
                              },
                              "&:hover fieldset": {
                                borderColor: "rgba(56,189,248,0.95)",
                              },
                              "&.Mui-focused fieldset": {
                                borderColor: "rgba(14,165,233,1)",
                                borderWidth: "2px",
                              },
                            },
                            "& .MuiInputBase-input": {
                              fontSize: "0.95rem",
                              color: "#0f172a",
                            },
                          }}
                        />

                        <div className="flex gap-2 sm:justify-end">
                          <Button
                            variant="contained"
                            onClick={() => void handleAiSearch()}
                            disabled={!canRunAiSearch}
                            startIcon={
                              isAiSearching ? (
                                <CircularProgress color="inherit" size={16} />
                              ) : (
                                <AutoAwesomeOutlinedIcon />
                              )
                            }
                            sx={{
                              minHeight: 54,
                              minWidth: 128,
                              borderRadius: "18px",
                              textTransform: "none",
                              fontWeight: 700,
                              fontSize: "0.9rem",
                              boxShadow:
                                "0 18px 35px -22px rgba(29,78,216,0.9)",
                              background:
                                "linear-gradient(135deg, #0284c7 0%, #1d4ed8 100%)",
                              "&:hover": {
                                background:
                                  "linear-gradient(135deg, #0369a1 0%, #1e40af 100%)",
                              },
                            }}
                          >
                            {isAiSearching ? "Searching..." : "Ask AI"}
                          </Button>
                          <Button
                            variant="outlined"
                            onClick={() => {
                              setSearch("");
                              setAiAnswer(null);
                            }}
                            disabled={!search && !aiAnswer}
                            startIcon={<CloseRoundedIcon />}
                            sx={{
                              minHeight: 54,
                              borderRadius: "18px",
                              textTransform: "none",
                              fontWeight: 600,
                              fontSize: "0.9rem",
                              borderColor: "rgba(186,230,253,0.95)",
                              color: "#0369a1",
                            }}
                          >
                            Clear
                          </Button>
                        </div>
                      </div>

                      <div className="mt-2.5 flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-sky-50 px-3 py-1 text-[11px] font-semibold text-sky-700 ring-1 ring-sky-100">
                          {statusLabel}
                        </span>
                        <span className="rounded-full bg-slate-100 px-3 py-1 text-[11px] font-medium text-slate-600 ring-1 ring-slate-200">
                          Instant title filtering stays active while you type
                        </span>
                        <span className="rounded-full bg-indigo-50 px-3 py-1 text-[11px] font-medium text-indigo-700 ring-1 ring-indigo-100">
                          AI answers cite note and file sources
                        </span>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

            <div>{children}</div>

            <div className="fixed bottom-0 right-0 p-6">
              <Button
                color="primary"
                variant="contained"
                className="rounded-full! p-3!"
                aria-label="add note"
                onClick={() => {
                  setOpenNoteModal(true);
                  setEditNote(null);
                }}
              >
                <AddRoundedIcon />
              </Button>
            </div>

            <Modal
              open={openNoteModal}
              onClose={() => setOpenNoteModal(false)}
              aria-labelledby="modal-modal-title"
              aria-describedby="modal-modal-description"
            >
              <Box sx={modalStyle()}>
                <NoteEditor
                  onSave={async (data, id) => {
                    let res: INote | null = null;
                    if (id) {
                      res = await updateNote(id, data);
                    } else {
                      res = await createNote(data);
                    }
                    if (res) dispatch(addNote(res));
                    setOpenNoteModal(false);
                  }}
                  initialNote={editNote}
                  categoryOptions={Array.from(
                    new Set(notes.map((note) => note.category)),
                  )}
                />
              </Box>
            </Modal>
          </>
        )}
      </div>
    </NotesContext.Provider>
  );
}
