"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { ArrowRight, Lock, Mail } from "lucide-react";
import { login } from "@/services/authService";
import { getValidToken } from "@/services/session";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { setToken } from "@/store/slices/authSlice";
import { AuthShell, FormAlert } from "@/components/authShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleSignIn } from "@/components/googleSignIn";
import { useT } from "@/i18n";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const dispatch = useAppDispatch();
  const router = useRouter();
  const t = useT();

  useEffect(() => {
    if (getValidToken()) {
      router.replace("/notes");
      return;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.get("expired")) setNotice(t("auth.expired"));
    if (params.get("reset")) setNotice(t("auth.passwordUpdated"));
  }, [router, t]);

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
          ? t("auth.wrong")
          : getErrorMessage(err, t("auth.signInFailed")),
      );
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.welcome")}
      subtitle={t("auth.welcomeText")}
      footer={
        <>
          {t("auth.newHere")}{" "}
          <Link href="/register" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            {t("auth.createAccount")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleLogin} className="flex flex-col gap-4" noValidate={false}>
        {notice && !error && <FormAlert tone="info">{notice}</FormAlert>}
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label={t("auth.email")}
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
            label={t("auth.password")}
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
            {t("auth.resetLink")}
          </Link>
        </div>
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? t("auth.signingIn") : t("auth.signIn")}
          {!isLoading && <ArrowRight className="size-4" />}
        </Button>
      </form>
      <GoogleSignIn disabled={isLoading} onError={setError} />
    </AuthShell>
  );
}
