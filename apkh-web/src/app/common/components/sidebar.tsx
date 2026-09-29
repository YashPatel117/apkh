"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useMemo } from "react";
import {
  ChevronsUpDown,
  CircleUserRound,
  Cpu,
  FolderOpen,
  LogOut,
  MessagesSquare,
  NotebookText,
  Plus,
  TriangleAlert,
} from "lucide-react";
import { INote } from "../models/note";
import { IUser } from "../models/user";
import { LogoMark, Wordmark } from "../ui/Logo";
import { Button } from "../ui/Button";
import { Menu, MenuItem } from "../ui/Menu";
import { cn } from "../ui/cn";

interface SidebarProps {
  user: IUser;
  notes: INote[];
  sessionsCount: number;
  activeCategory: string | null;
  onCategory: (category: string | null) => void;
  onNewNote: () => void;
  onNavigate?: () => void;
  onLogout: () => void;
}

export function initials(name: string) {
  return name
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase())
    .join("");
}

const avatarSizes = {
  sm: "size-8 text-[0.7rem] ring-2",
  md: "size-9 text-xs ring-2",
  xl: "size-20 text-2xl ring-4 sm:size-24 sm:text-3xl",
};

export function Avatar({ name, size = "md", className }: { name: string; size?: keyof typeof avatarSizes; className?: string }) {
  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full bg-linear-to-br from-blue-500 via-indigo-500 to-violet-500 font-bold text-white ring-surface",
        avatarSizes[size],
        className,
      )}
      aria-hidden
    >
      {initials(name)}
    </span>
  );
}

export function Sidebar({ user, notes, sessionsCount, activeCategory, onCategory, onNewNote, onNavigate, onLogout }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const activeConfig = user.llmConfigs?.find((c) => c.isActive) ?? null;

  const categories = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of notes) {
      const c = note.category?.trim();
      if (c) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [notes]);

  const nav = [
    { href: "/notes", label: "Notes", Icon: NotebookText, count: notes.length },
    { href: "/chat", label: "Chats", Icon: MessagesSquare, count: sessionsCount || undefined },
    { href: "/profile", label: "Profile & AI", Icon: CircleUserRound },
  ];

  const pickCategory = (category: string | null) => {
    onCategory(category);
    if (pathname !== "/notes") router.push("/notes");
    onNavigate?.();
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-16 shrink-0 items-center gap-2.5 px-5">
        <Link href="/notes" onClick={onNavigate} className="flex items-center gap-2.5" aria-label="Knowledge Hub">
          <LogoMark size={34} />
          <Wordmark />
        </Link>
      </div>

      <div className="px-3">
        <Button
          onClick={() => {
            onNewNote();
            onNavigate?.();
          }}
          className="w-full"
          icon={<Plus className="size-4" />}
        >
          New note
        </Button>
      </div>

      <nav className="mt-5 space-y-0.5 px-3" aria-label="Main">
        {nav.map(({ href, label, Icon, count }) => {
          const active = pathname === href || pathname.startsWith(`${href}/`);
          return (
            <Link
              key={href}
              href={href}
              onClick={() => {
                if (href === "/notes") onCategory(null);
                onNavigate?.();
              }}
              aria-current={active ? "page" : undefined}
              className={cn(
                "group flex h-10 items-center gap-3 rounded-xl px-3 text-sm font-medium transition-colors",
                active ? "bg-accent-soft text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
              )}
            >
              <Icon className={cn("size-[1.1rem]", active ? "text-accent" : "text-fg-muted group-hover:text-fg")} />
              <span className="flex-1">{label}</span>
              {count !== undefined && (
                <span className={cn("rounded-md px-1.5 text-xs tabular-nums", active ? "text-accent-fg" : "text-fg-subtle")}>{count}</span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="mt-6 min-h-0 flex-1 overflow-y-auto px-3 pb-3">
        {categories.length > 0 && (
          <>
            <p className="px-3 pb-1.5 text-[0.68rem] font-semibold tracking-wider text-fg-subtle uppercase">Categories</p>
            <ul className="space-y-0.5">
              {categories.map(([name, count]) => {
                const active = activeCategory === name && pathname === "/notes";
                return (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => pickCategory(active ? null : name)}
                      aria-pressed={active}
                      className={cn(
                        "flex h-9 w-full cursor-pointer items-center gap-3 rounded-xl px-3 text-left text-sm transition-colors",
                        active ? "bg-accent-soft font-medium text-accent-fg" : "text-fg-muted hover:bg-surface-2 hover:text-fg",
                      )}
                    >
                      <FolderOpen className={cn("size-4 shrink-0", active ? "text-accent" : "text-fg-muted")} />
                      <span className="flex-1 truncate">{name}</span>
                      <span className="text-xs text-fg-subtle tabular-nums">{count}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>

      <div className="shrink-0 space-y-3 border-t border-line p-3">
        <Link
          href="/profile"
          onClick={onNavigate}
          className={cn(
            "flex items-center gap-3 rounded-xl px-3 py-2.5 text-xs transition-colors",
            activeConfig
              ? "bg-surface-2 text-fg-muted hover:text-fg"
              : "bg-amber-50 text-amber-800 hover:bg-amber-100 dark:bg-amber-500/10 dark:text-amber-300 dark:hover:bg-amber-500/15",
          )}
        >
          {activeConfig ? <Cpu className="size-4 shrink-0 text-accent" /> : <TriangleAlert className="size-4 shrink-0" />}
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">{activeConfig ? "AI model active" : "AI not configured"}</span>
            <span className="block truncate opacity-80">{activeConfig ? activeConfig.llmModel : "Add an API key to ask AI"}</span>
          </span>
        </Link>

        <Menu
          side="top"
          align="left"
          className="w-full"
          trigger={({ toggle, open }) => (
            <button
              type="button"
              onClick={toggle}
              aria-expanded={open}
              aria-haspopup="menu"
              className="flex w-full cursor-pointer items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <Avatar name={user.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-fg">{user.name}</span>
                <span className="block truncate text-xs text-fg-subtle">{user.email}</span>
              </span>
              <ChevronsUpDown className="size-4 shrink-0 text-fg-subtle" />
            </button>
          )}
        >
          {(close) => (
            <>
              <div className="px-3 py-2">
                <span className="rounded-md bg-accent-soft px-1.5 py-0.5 text-[0.68rem] font-bold tracking-wider text-accent-fg uppercase">
                  {user.type} plan
                </span>
              </div>
              <MenuItem
                icon={<CircleUserRound />}
                onClick={() => {
                  close();
                  onNavigate?.();
                  router.push("/profile");
                }}
              >
                Profile & AI settings
              </MenuItem>
              <div className="my-1 h-px bg-line" />
              <MenuItem danger icon={<LogOut />} onClick={onLogout}>
                Sign out
              </MenuItem>
            </>
          )}
        </Menu>
      </div>
    </div>
  );
}
