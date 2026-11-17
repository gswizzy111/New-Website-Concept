"use client";

import { useRouter } from "next/navigation";

export function LogoutButton() {
  const router = useRouter();

  async function handleLogout() {
    await fetch("/api/account/auth/logout", { method: "POST" });
    router.push("/account/login");
    router.refresh();
  }

  return (
    <button
      onClick={handleLogout}
      className="inline-flex min-h-11 items-center rounded-full px-3 text-sm font-bold text-ink-soft transition-colors hover:bg-chalk hover:text-ink"
    >
      Sign out
    </button>
  );
}
