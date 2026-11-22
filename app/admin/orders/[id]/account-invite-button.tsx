"use client";

import { useState } from "react";

/** Send Sign-up Email: a thank-you with a link to make an account and track the order. */
export function AccountInviteButton({ orderId, customerEmail }: { orderId: string; customerEmail: string | null }) {
  const [status, setStatus] = useState<"idle" | "sending" | "done" | "error">("idle");
  const [message, setMessage] = useState("");
  const email = (customerEmail ?? "").trim();

  async function handleClick() {
    if (!email) {
      setStatus("error");
      setMessage("This order has no email. Add the customer's email first.");
      return;
    }
    if (!confirm(`Email ${email} a link to sign up and track this order?`)) return;
    setStatus("sending");
    setMessage("");
    try {
      const res = await fetch(`/api/admin/orders/${orderId}/account-invite`, { method: "POST" });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStatus("error");
        setMessage(data.error ?? "The email didn't send. Try again.");
        return;
      }
      setStatus("done");
      setTimeout(() => setStatus("idle"), 4000);
    } catch {
      setStatus("error");
      setMessage("Network error. Try again.");
    }
  }

  return (
    <button
      onClick={handleClick}
      disabled={status === "sending"}
      title={status === "error" ? message : `Email ${email || "the customer"} a link to sign up and track this order`}
      className={`text-xs font-semibold px-3 py-1.5 rounded-lg border transition-colors disabled:opacity-50 ${
        status === "done"
          ? "bg-green-50 text-green-700 border-green-200"
          : status === "error"
          ? "bg-red-50 text-red-700 border-red-200"
          : "bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100"
      }`}
    >
      {status === "sending" ? "Sending…" : status === "done" ? "✓ Sign-up email sent" : status === "error" ? (message ? `✕ ${message}` : "Failed — retry") : "✉️ Send Sign-up Email"}
    </button>
  );
}
