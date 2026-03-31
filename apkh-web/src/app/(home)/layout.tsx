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
import { createNote, searchNotes, updateNote, aiSearchNotes, AiSearchResponse } from "@/service/noteService";
import { addNote } from "@/store/slices/noteSlice";
import { modalStyle } from "../common/style/modal";
import { INote } from "../common/models/note";
import { NotesContext } from "../common/context/notesContext";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import ContentPasteSearchOutlinedIcon from "@mui/icons-material/ContentPasteSearchOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
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
    if (token) {
      const decoded = jwtDecode(token);
      const currentTime = Date.now() / 1000;
      if (decoded.exp && decoded.exp < currentTime) {
        handleLogout();
      } else {
        dispatch(setToken(token));
        if (!user && !isFetchingProfile) {
          isFetchingProfile = true;
          (async () => {
             try {
               const fetchedUser = await profile();
               dispatch(setUser(fetchedUser));
             } finally {
               isFetchingProfile = false;
             }
          })();
        }
      }
    } else router.push("/login");
  }, []);

  useEffect(() => {
    setAiAnswer(null); // Clear AI context if typing normal search
    if (search) {
      const filtered = notes.filter((note) =>
        note.title.toLowerCase().includes(search.toLowerCase())
      );
      setFilteredNotes(filtered);
    } else setFilteredNotes(notes);
  }, [search, notes]);

  const openNote = (noteId: string) => {
    setOpenNoteModal(true);
    setEditNote(notes.find((note) => note.id === noteId) ?? null);
  };

  async function handleAiSearch() {
    setIsAiSearching(true);
    try {
      const res = await aiSearchNotes(search);
      if (res) {
        setAiAnswer(res);
        const referencedNoteIds = res.references.map((r) => r.note_id);
        const filtered = notes.filter((n) => referencedNoteIds.includes(n.id));
        setFilteredNotes(filtered.length > 0 ? filtered : []);
      }
    } catch (e) {
      console.error(e);
      setFilteredNotes([]);
    } finally {
      setIsAiSearching(false);
    }
  }

  return (
    <NotesContext.Provider value={{ openNote, filteredNotes, aiAnswer, isAiSearching }}>
      <style>{`
      @media (max-width: 400px) {
        .p-name {
          display: none;
        }
`}</style>
      <div>
        {user && (
          <>
            <div className="flex justify-between items-center p-6 gap-4">
              <div>
                <svg width="100" height="40" viewBox="0 0 100 40" xmlns="http://www.w3.org/2000/svg">
                  <text 
                    x="5" y="28" 
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
              <div className="flex-1 max-w-2xl">
                <TextField
                  id="search"
                  label="Search"
                  slotProps={{
                    input: {
                      startAdornment: (
                        <InputAdornment position="start">
                          <ContentPasteSearchOutlinedIcon />
                        </InputAdornment>
                      ),
                      endAdornment: (
                        <InputAdornment position="end">
                          <IconButton
                            disabled={search.length <= 3}
                            onClick={async () => await handleAiSearch()}
                          >
                            <AutoAwesomeOutlinedIcon />
                          </IconButton>
                        </InputAdornment>
                      ),
                    },
                  }}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  variant="outlined"
                  className="w-full"
                />
              </div>
              <div className="flex items-center gap-2">
                <div className="relative inline-block">
                  <button
                    className="px-4 py-2 flex rounded items-center gap-2 hover:bg-gray-100 transition-colors"
                    onClick={() => setOpenProfileMenu(!openProfileMenu)}
                  >
                    <Avatar sx={{ bgcolor: "var(--color-blue-600)" }}>{user.name.split(" ").map((word) => word[0])}</Avatar>
                    <span className="p-name font-medium">{user.name}</span>
                  </button>

                  <div
                    className={`absolute right-0 mt-2 w-40 bg-white rounded shadow-lg transform transition-all duration-300 origin-top z-50 ${
                      openProfileMenu
                        ? "scale-y-100 opacity-100 border"
                        : "scale-y-0 opacity-0 border-0"
                    }`}
                  >
                    <Link
                      href="/profile"
                      className="block px-4 py-2 hover:bg-gray-100 cursor-pointer text-gray-800"
                    >
                      Profile
                    </Link>
                    <div className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-gray-800">
                      {user.type.toUpperCase()} (Upgrade)
                    </div>
                    <div
                      className="px-4 py-2 hover:bg-gray-100 cursor-pointer text-red-600"
                      onClick={handleLogout}
                    >
                      Logout
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
                aria-label="add to shopping cart"
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
                    new Set(notes.map((note) => note.category))
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
