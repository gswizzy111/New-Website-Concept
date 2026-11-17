import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountHeader } from "../account-header";
import { ProfileForm, PasswordForm } from "./settings-forms";
import { PAGE_TITLE } from "@/components/account/portal";

export const dynamic = "force-dynamic";

export default async function AccountSettingsPage() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user?.email) redirect("/account/login");

  const meta = (user.user_metadata ?? {}) as {
    name?: string; phone?: string;
    address?: { street1?: string; street2?: string; city?: string; state?: string; zip?: string } | null;
  };

  return (
    <div className="surface-chalk min-h-screen">
      <AccountHeader email={user.email} active="settings" />
      <div className="mx-auto flex max-w-3xl flex-col gap-6 px-4 py-10 sm:px-6 md:py-14">
        <div className="mb-2">
          <h1 className={PAGE_TITLE}>Settings</h1>
          <p className="mt-3 text-[17px] text-ink-soft">Your details fill in automatically when you check out.</p>
        </div>
        <ProfileForm
          email={user.email}
          initial={{
            name: meta.name ?? "",
            phone: meta.phone ?? "",
            street1: meta.address?.street1 ?? "",
            street2: meta.address?.street2 ?? "",
            city: meta.address?.city ?? "",
            state: meta.address?.state ?? "",
            zip: meta.address?.zip ?? "",
          }}
        />
        <PasswordForm />
      </div>
    </div>
  );
}
