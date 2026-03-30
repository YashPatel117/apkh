"use client";

import { useAppSelector } from "@/store/hook";
import Button from "@mui/material/Button";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
export default function ProfilePage() {
  const { user } = useAppSelector((state) => state.auth);

  return (
    <main className="p-6">
      <div>
        <Button variant="outlined" className="gap-2 flex items-center" onClick={() => window.history.back()}>
          <ArrowBackIcon fontSize="small"/>
          <span className="text-sm">Back</span>
        </Button>
      </div>
      <div>{user?.name}</div>
      <div>{user?.email}</div>
      <div>{user?.type}</div>
    </main>
  );
}
