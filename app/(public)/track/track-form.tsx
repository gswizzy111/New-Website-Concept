"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Print } from "@/components/brand";
import mantleInHand from "@/public/about/mantle-in-hand.jpg";
import charmanderAfter from "@/public/home/charmander-after.jpg";

export function TrackForm({ initialOrder = "" }: { initialOrder?: string }) {
  const router = useRouter();
  const [orderNumber, setOrderNumber] = useState(initialOrder);
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!orderNumber.trim() || !email.trim()) {
      toast.error("Please enter both your order number and email.");
      return;
    }
    setLoading(true);
    router.push(
      `/orders/${orderNumber.trim().toUpperCase()}?email=${encodeURIComponent(email.trim())}`
    );
  }

  return (
    <section className="surface-chalk relative flex-1 overflow-x-clip">
      <div className="wrap grid items-center gap-x-16 gap-y-14 py-14 md:py-24 lg:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)]">
        {/* Look up an order */}
        <div className="min-w-0">
          <p className="hero-in eyebrow mb-5 inline-flex items-center gap-2.5 text-cobalt">
            <span aria-hidden className="h-[3px] w-6 rounded-full bg-cobalt" />
            Track Order
          </p>
          <h1 className="hero-in font-display text-[clamp(3rem,12vw,4.25rem)] leading-[0.9] font-black text-ink md:text-[clamp(4.25rem,7vw,6.25rem)]">
            Track your order.
          </h1>
          <p className="hero-in lead mt-6 text-ink-soft" style={{ ["--d" as string]: 120 }}>
            Enter your order number and email to view status.
          </p>

          <form
            onSubmit={handleSubmit}
            className="hero-in panel mt-10 flex max-w-md flex-col gap-5 p-6 md:p-8"
            style={{ ["--d" as string]: 200 }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor="orderNumber" className="text-[15px] font-bold text-ink">Order Number</Label>
              <Input
                id="orderNumber"
                placeholder="R1042 or K5"
                value={orderNumber}
                onChange={(e) => setOrderNumber(e.target.value)}
                autoComplete="off"
                className="h-12 font-bold tracking-[0.02em] md:text-[16px]"
              />
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email" className="text-[15px] font-bold text-ink">Email</Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                className="h-12 md:text-[16px]"
              />
            </div>

            <Button type="submit" variant="ink" size="lg" className="mt-2 h-[58px] w-full text-[17px]" disabled={loading}>
              {loading ? "Looking up..." : "View Order"}
              {!loading && <ArrowRight aria-hidden className="size-5" strokeWidth={2} />}
            </Button>
          </form>
        </div>

        {/* Real cards, back from the bench (decorative) */}
        <div aria-hidden className="relative mx-auto hidden aspect-[1/1] w-full max-w-[30rem] md:block">
          <Print
            src={charmanderAfter}
            alt=""
            aspect="364/503"
            tilt={-9}
            enterDelay={260}
            sizes="240px"
            className="absolute top-[14%] left-0 w-[46%]"
          />
          <Print
            src={mantleInHand}
            alt=""
            aspect="701/922"
            tilt={5}
            border="lg"
            enterDelay={380}
            sizes="300px"
            className="absolute top-0 right-0 w-[60%]"
          />
        </div>
      </div>
    </section>
  );
}
