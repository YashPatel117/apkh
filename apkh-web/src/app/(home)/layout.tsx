"use client";

import { profile } from "@/service/authService";
import { useAppSelector, useAppDispatch } from "@/store/hook";
import { logout, setToken, setUser } from "@/store/slices/authSlice";
import { jwtDecode } from "jwt-decode";
import Image from "next/image";
import { useRouter } from "next/navigation";
import React, { useEffect, useState } from "react";
import Avatar from "@mui/material/Avatar";
import Link from "next/link";
import AddRoundedIcon from "@mui/icons-material/AddRounded";
import Button from "@mui/material/Button";
import Modal from "@mui/material/Modal";
import NoteEditor from "../common/components/noteEditor";
import Box from "@mui/material/Box";
import { createNote, searchNotes, updateNote } from "@/service/noteService";
import { addNote } from "@/store/slices/noteSlice";
import { modalStyle } from "../common/style/modal";
import { INote } from "../common/models/note";
import { NotesContext } from "../common/context/notesContext";
import { IconButton, InputAdornment, TextField } from "@mui/material";
import ContentPasteSearchOutlinedIcon from "@mui/icons-material/ContentPasteSearchOutlined";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";

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
      if (decoded.exp && decoded.exp < currentTime) handleLogout();
      else {
        dispatch(setToken(token));
        if (!user)
          (async () => {
            const user = await profile();
            dispatch(setUser(user));
          })();
      }
    } else router.push("/login");
  }, []);

  useEffect(() => {
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
    const res = await searchNotes(search);
    if (res) setFilteredNotes(res);
    else setFilteredNotes([]);
  }

  return (
    <NotesContext.Provider value={{ openNote, filteredNotes }}>
      <style>{`
      @media (max-width: 400px) {
        .p-name {
          display: none;
        }
`}</style>
      <div>
        {user && (
          <>
            <div className="flex justify-between items-center p-6">
              <div>
                <Image
                  src={"/images/favicon.ico"}
                  width={50}
                  height={50}
                  alt="Logo"
                />
              </div>
              <div className="flex-1">
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
              <div className="relative inline-block">
                <button
                  className="px-4 py-2 flex rounded items-center gap-2"
                  onClick={() => setOpenProfileMenu(!openProfileMenu)}
                >
                  <Avatar>{user.name.split(" ").map((word) => word[0])}</Avatar>
                  <span className="p-name">{user.name}</span>
                </button>

                <div
                  className={`absolute right-0 mt-2 w-40 bg-white rounded shadow-lg transform transition-all duration-300 origin-top ${
                    openProfileMenu
                      ? "scale-y-100 opacity-100 border"
                      : "scale-y-0 opacity-0 border-0"
                  }`}
                >
                  <Link
                    href="/profile"
                    className="block px-4 py-2 hover:bg-gray-100 cursor-pointer"
                  >
                    Profile
                  </Link>
                  <div className="px-4 py-2 hover:bg-gray-100 cursor-pointer">
                    {user.type.toUpperCase()} (Upgrade)
                  </div>
                  <div
                    className="px-4 py-2 hover:bg-gray-100 cursor-pointer"
                    onClick={handleLogout}
                  >
                    Logout
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
