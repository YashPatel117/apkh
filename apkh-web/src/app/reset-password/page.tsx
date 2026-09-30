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

const MIN_PASSWORD = 6;

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  const mismatch = confirm.length > 0 && confirm !== password;

  const handleReset = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    if (password !== confirm) {
      setError("Passwords don't match.");
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
          ? "Email or current password is incorrect."
          : getErrorMessage(err, "Password reset failed. Please try again."),
      );
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Confirm your current password, then choose a new one."
      footer={
        <>
          Remembered it?{" "}
          <Link href="/login" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            Back to sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleReset} className="flex flex-col gap-4">
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
        <Input
          label="Current password"
          type="password"
          autoComplete="current-password"
          placeholder="Your current password"
          icon={<Lock />}
          value={currentPassword}
          onChange={(e) => setCurrentPassword(e.target.value)}
          required
        />
        <Input
          label="New password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          icon={<Lock />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
        />
        <Input
          label="Confirm new password"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat the new password"
          icon={<Lock />}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={mismatch ? "Passwords don't match." : null}
          required
        />
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? "Updating…" : "Update password"}
        </Button>
      </form>
    </AuthShell>
  );
}
