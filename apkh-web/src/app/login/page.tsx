"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { login } from "@/service/authService";
import { getValidToken } from "@/service/session";
import { getErrorMessage } from "@/service/axios/axios";
import { useAppDispatch } from "@/store/hook";
import { setToken } from "@/store/slices/authSlice";
import { AuthShell, FormAlert } from "../common/components/authShell";
import { Input } from "../common/ui/Input";
import { Button } from "../common/ui/Button";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const router = useRouter();

  useEffect(() => {
    if (getValidToken()) {
      router.replace("/notes");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("expired")) setNotice("Your session has expired. Please sign in again.");
    if (params.get("reset")) setNotice("Password updated. Sign in with your new password.");
  }, [router]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setError(null);
    try {
      const data = await login(email.trim(), password);
      dispatch(setToken(data.data));
      router.replace("/notes");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.status === 401
          ? "Incorrect email or password."
          : getErrorMessage(err, "Couldn't sign you in. Please try again."),
      );
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to pick up where your knowledge left off."
      footer={
        <>
          New to Knowledge Hub?{" "}
          <Link href="/register" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            Create an account
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate={false}>
        {notice && !error && <FormAlert tone="info">{notice}</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          icon={<Mail />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <Input
            label="Password"
            type="password"
            autoComplete="current-password"
            placeholder="••••••••"
            icon={<Lock />}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <Link
            href="/reset-password"
            className="self-end text-xs font-medium text-indigo-700 hover:underline dark:text-indigo-300"
          >
            Forgot password?
          </Link>
        </div>
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? "Signing in…" : "Sign in"}
          {!isLoading && <ArrowRight className="size-4" />}
        </Button>
      </form>
    </AuthShell>
  );
}
