import type { Metadata } from "next";
import { canonical } from "@/lib/seo";
import { TrackForm } from "./track-form";

export const metadata: Metadata = {
  title: "Track My Order | The Card Doc",
  description: "Enter your order number and email to view status.",
  alternates: canonical("/track"),
};

export default async function TrackPage({
  searchParams,
}: {
  searchParams: Promise<{ order?: string }>;
}) {
  const { order } = await searchParams;
  return <TrackForm initialOrder={order ?? ""} />;
}
