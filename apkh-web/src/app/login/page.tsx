"use client";

import { useEffect, useState } from "react";
import { useAppDispatch } from "@/store/hook";
import { setUser, setToken, logout } from "@/store/slices/authSlice";
import { setNotes } from "@/store/slices/noteSlice";
import { login, profile } from "@/service/authService";
import { getAllNotes } from "@/service/noteService";
import { useRouter } from "next/navigation";
import { jwtDecode } from "jwt-decode";
import { motion } from "framer-motion";
import Link from "next/link";
import { TextField, Button } from "@mui/material";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const dispatch = useAppDispatch();
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const data = await login(email, password);
      const [fetchedUser, notes] = await Promise.all([profile(), getAllNotes()]);
      dispatch(setToken(data.data)); // "data.data" is the token
      dispatch(setUser(fetchedUser));
      dispatch(setNotes(notes));
      router.push("/notes");
    } catch {
      alert("Login failed");
    } finally {
      setIsLoading(false);
    }
  };

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
    <main className="min-h-screen flex items-center justify-center bg-gray-50 transition-colors duration-300 px-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-[-10%] left-[-10%] w-96 h-96 bg-blue-500/20 rounded-full blur-3xl pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-96 h-96 bg-purple-500/20 rounded-full blur-3xl pointer-events-none" />

      <motion.div
        initial={{ opacity: 0, y: 30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: "easeOut" }}
        className="w-full max-w-md bg-white/80 backdrop-blur-xl shadow-2xl rounded-2xl p-8 border border-white/20"
      >
        <div className="text-center mb-8">
          <motion.h1 
            initial={{ scale: 0.9 }}
            animate={{ scale: 1 }}
            className="text-3xl font-extrabold text-gray-800 tracking-tight"
          >
            Welcome Back
          </motion.h1>
          <p className="text-gray-500 mt-2">Log in to your account to continue</p>
        </div>

        <form onSubmit={handleLogin} className="flex flex-col gap-5">
          <TextField
            label="Email Address"
            variant="outlined"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                "& fieldset": { borderColor: "var(--color-slate-300)" },
                "&:hover fieldset": { borderColor: "var(--color-blue-400)" },
                "&.Mui-focused fieldset": { borderColor: "var(--color-blue-500)" },
              },
            }}
          />
          <TextField
            label="Password"
            variant="outlined"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            fullWidth
            sx={{
              "& .MuiOutlinedInput-root": {
                "& fieldset": { borderColor: "var(--color-slate-300)" },
                "&:hover fieldset": { borderColor: "var(--color-blue-400)" },
                "&.Mui-focused fieldset": { borderColor: "var(--color-blue-500)" },
              },
            }}
          />

          <div className="flex justify-end mt-[-10px]">
            <Link 
              href="/reset-password" 
              className="text-sm text-blue-600 hover:underline transition-all"
            >
              Forgot Password?
            </Link>
          </div>

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }}>
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              size="large"
              disabled={isLoading}
              className="py-3 rounded-lg font-bold shadow-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            >
              {isLoading ? "Logging in..." : "Login"}
            </Button>
          </motion.div>
        </form>

        <div className="mt-6 text-center text-gray-500">
          Don&apos;t have an account?{" "}
          <Link href="/register" className="text-blue-600 font-semibold hover:underline">
            Sign up
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
