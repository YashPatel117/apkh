"use client";

import { useEffect, useState } from "react";
import { useAppDispatch, useAppSelector } from "@/store/hook";
import { setUser, setToken, logout } from "@/store/slices/authSlice";
import { login, profile } from "@/service/authService";
import { useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const dispatch = useAppDispatch();
  const router = useRouter();
  const { user } = useAppSelector((state) => state.auth);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const data = await login(email, password);
      const user = await profile();
      dispatch(setToken(data.data));
      dispatch(setUser(user));
      router.push("/notes");
    } catch (err) {
      alert("Login failed");
    }
  };

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
            router.push("/notes");
          })();
      }
    } else router.push("/login");
  }, []);

  return (
    <main className="p-6">
      <h1>Login</h1>
      <form onSubmit={handleLogin} className="flex flex-col gap-2 w-64">
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="border p-2"
        />
        <input
          type="password"
          placeholder="Password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="border p-2"
        />
        <button type="submit" className="bg-blue-500 text-white p-2">
          Login
        </button>
      </form>
    </main>
  );
}
