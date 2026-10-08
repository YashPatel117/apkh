"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowRight, Lock, Mail, User } from "lucide-react";
import { register } from "@/services/authService";
import { getValidToken } from "@/services/session";
import { getErrorMessage } from "@/services/axios";
import { useAppDispatch } from "@/store/hook";
import { setToken } from "@/store/slices/authSlice";
import { AuthShell, FormAlert } from "@/components/authShell";
import { Input } from "@/components/ui/Input";
import { Button } from "@/components/ui/Button";
import { GoogleSignIn } from "@/components/googleSignIn";
import { PasswordChecklist } from "@/components/passwordChecklist";
import { checkPassword, PASSWORD_MAX } from "@/lib/passwordRules";
import { useT } from "@/i18n";

export default function RegisterPage() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const dispatch = useAppDispatch();
  const t = useT();

  useEffect(() => {
    if (getValidToken()) router.replace("/notes");
  }, [router]);

  const passwordCheck = checkPassword(password, { name, email });

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordCheck.valid) {
      setError(t("auth.passwordRulesFailed"));
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const res = await register({ name: name.trim(), email: email.trim(), password });
      dispatch(setToken(res.data));
      router.replace("/notes");
    } catch (err) {
      setError(getErrorMessage(err, t("auth.registerFailed")));
      setIsLoading(false);
    }
  };

  return (
    <AuthShell
      title={t("auth.registerTitle")}
      subtitle={t("auth.registerText")}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link href="/login" className="font-semibold text-indigo-700 hover:underline dark:text-indigo-300">
            {t("auth.signIn")}
          </Link>
        </>
      }
    >
      <form onSubmit={handleRegister} className="flex flex-col gap-4">
        {error && <FormAlert>{error}</FormAlert>}
        <Input
          label={t("auth.fullName")}
          autoComplete="name"
          placeholder="Ada Lovelace"
          icon={<User />}
          value={name}
          onChange={(e) => setName(e.target.value)}
          required
          autoFocus
        />
        <Input
          label={t("auth.email")}
          type="email"
          autoComplete="email"
          placeholder="you@example.com"
          icon={<Mail />}
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
        />
        <Input
          label={t("auth.password")}
          type="password"
          autoComplete="new-password"
          placeholder={t("auth.passwordPlaceholder")}
          icon={<Lock />}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          maxLength={PASSWORD_MAX}
          aria-describedby="register-password-rules"
          aria-invalid={password.length > 0 && !passwordCheck.valid}
          required
        />
        <PasswordChecklist id="register-password-rules" password={password} context={{ name, email }} />
        <Button type="submit" size="lg" loading={isLoading} className="mt-2 w-full">
          {isLoading ? t("auth.creating") : t("auth.create")}
          {!isLoading && <ArrowRight className="size-4" />}
        </Button>
      </form>
      <GoogleSignIn disabled={isLoading} onError={setError} />
    </AuthShell>
  );
}
