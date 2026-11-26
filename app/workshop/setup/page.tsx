import { getRealAdminSession } from "@/lib/admin-auth";
import { AdminSignedIn, WorkshopSetup } from "./setup-form";

/**
 * The one-time link a new worker gets from the admin's Team page
 * (lib/workshop-users.ts): they choose their password and are signed in.
 * In a browser where a full admin is signed in (the owner trying the link
 * on their own phone, say), nothing is shown to set and nothing is changed:
 * signing the worker in there would replace the admin's session.
 * POST /api/workshop/setup checks the same.
 */
export const dynamic = "force-dynamic";

export default async function WorkshopSetupPage() {
  const session = await getRealAdminSession();
  return (
    <div className="min-h-screen bg-secondary flex items-center justify-center px-4">
      <div className="bg-white rounded-xl border border-border p-8 w-full max-w-sm shadow-sm">
        {session?.role === "admin" ? <AdminSignedIn /> : <WorkshopSetup />}
      </div>
    </div>
  );
}
