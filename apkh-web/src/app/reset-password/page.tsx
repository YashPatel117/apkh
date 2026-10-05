"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import axios from "axios";
import { Lock, Mail } from "lucide-react";
import { resetPassword } from "@/services/authService";
import { getErrorMessage } from "@/services/axios";
import { AuthShell, FormAlert } from "@/components/authShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { useT } from "@/i18n";

const MIN_PASSWORD = 6;

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const t = useT();

  const mismatch = confirm.length > 0 && confirm !== password;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(t("auth.tooShort", { count: MIN_PASSWORD }));
      return;
    }
    if (password !== confirm) {
      setError(t("auth.mismatch"));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      await resetPassword({ email: email.trim(), currentPassword, password });
      router.replace("/login?reset=1");
    } catch (err) {
      setError(
        axios.isAxiosError(err) && err.response?.status === 401
          ? t("auth.resetWrong")
          : getErrorMessage(err, t("auth.resetFailed")),
      );
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.resetTitle")}
      subtitle={t("auth.resetText")}
      footer={
        <>
          {t("auth.remembered")}{" "}
          <Link href="/login" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            {t("auth.backToSignIn")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleReset} className="flex flex-col gap-4">
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
        <Input
          label={t("auth.currentPassword")}
          type="password"
          autoComplete="current-password"
          placeholder={t("auth.currentPh")}
          icon={<Lock />}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label={t("auth.newPassword")}
          type="password"
          autoComplete="new-password"
          placeholder={t("auth.atLeastSix", { count: MIN_PASSWORD })}
          icon={<Lock />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label={t("auth.confirmPassword")}
          type="password"
          autoComplete="new-password"
          placeholder={t("auth.repeatPh")}
          icon={<Lock />}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? t("auth.mismatch") : null}
          required
        />
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? t("auth.updating") : t("auth.update")}
        </Button>
      </form>
    </AuthShell>
  );
}
