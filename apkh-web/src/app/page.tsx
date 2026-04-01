"use client";

import { useAppDispatch } from "@/store/hook";
import { jwtDecode } from "jwt-decode";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { setUser, setToken, logout } from "@/store/slices/authSlice";


export default function Home() {
  const router = useRouter();
  const dispatch = useAppDispatch();

  const handleLogout = () => {
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
        router.push("/notes"); // layout will fetch user
      }
    }
  }, []);

  return (
    <main className="p-6">
    </main>
  );
}
