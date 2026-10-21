import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { AccountHeader } from "../account-header";
import { ProfileForm, PasswordForm } from "./settings-forms";

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
    <div className="min-h-screen bg-secondary/30">
      <AccountHeader email={user.email} active="settings" />
      <div className="max-w-2xl mx-auto px-6 py-10 flex flex-col gap-6">
        <div>
          <h1 className="font-heading font-black text-3xl text-foreground">Settings</h1>
          <p className="text-sm text-muted-foreground mt-1">Your details fill in automatically when you check out.</p>
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
