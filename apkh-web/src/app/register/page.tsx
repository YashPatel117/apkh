"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail, User } from "lucide-react";
import { register } from "@/service/authService";
import { getValidToken } from "@/service/session";
import { getErrorMessage } from "@/service/axios/axios";
import { useAppDispatch } from "@/store/hook";
import { setToken } from "@/store/slices/authSlice";
import { AuthShell, FormAlert } from "../common/components/authShell";
import { Input } from "../common/ui/Input";
import { Button } from "../common/ui/Button";

const MIN_PASSWORD = 6;

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const dispatch = useAppDispatch();

  useEffect(() => {
    if (getValidToken()) router.replace("/notes");
  }, [router]);

  const passwordTooShort = password.length > 0 && password.length < MIN_PASSWORD;

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < MIN_PASSWORD) {
      setError(`Password must be at least ${MIN_PASSWORD} characters.`);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await register({ name: name.trim(), email: email.trim(), password });
      dispatch(setToken(res.data));
      router.replace("/notes");
    } catch (err) {
      setError(getErrorMessage(err, "Registration failed. Please check your details."));
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title="Create your account"
      subtitle="Start building a second brain that answers back."
      footer={
        <>
          Already have an account?{" "}
          <Link href="/login" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            Sign in
          </Link>
        </>
      }
    >
      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label="Full name"
          autoComplete="name"
          placeholder="Ada Lovelace"
          icon={<User />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <Input
          label="Email"
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          icon={<Mail />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label="Password"
          type="password"
          autoComplete="new-password"
          placeholder="At least 6 characters"
          icon={<Lock />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={passwordTooShort ? `Use at least ${MIN_PASSWORD} characters.` : null}
          required
        />
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? "Creating account…" : "Create account"}
          {!isLoading && <ArrowRight className="size-4" />}
        </Button>
      </form>
    </AuthShell>
  );
}
