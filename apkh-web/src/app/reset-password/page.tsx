"use client";

import { useState } from "react";
import { resetPassword } from "@/service/authService";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import { TextField, Button } from "@mui/material";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      await resetPassword({ email, password });
      alert("Password reset successfully! Please login with your new password.");
      router.push("/login");
    } catch (err) {
      alert("Password reset failed. Please ensure the email is correct.");
      setIsLoading(false);
    }
  };

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
            Reset Password
          </motion.h1>
          <p className="text-gray-500 mt-2">Enter your email and new password</p>
        </div>

        <form onSubmit={handleReset} className="flex flex-col gap-5">
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
            label="New Password"
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

          <motion.div whileHover={{ scale: 1.02 }} whileTap={{ scale: 0.98 }} className="mt-2">
            <Button
              type="submit"
              variant="contained"
              color="primary"
              fullWidth
              size="large"
              disabled={isLoading}
              className="py-3 rounded-lg font-bold shadow-lg bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white"
            >
              {isLoading ? "Resetting..." : "Reset Password"}
            </Button>
          </motion.div>
        </form>

        <div className="mt-6 text-center text-gray-500">
          Remember your password?{" "}
          <Link href="/login" className="text-blue-600 font-semibold hover:underline">
            Log in
          </Link>
        </div>
      </motion.div>
    </main>
  );
}
