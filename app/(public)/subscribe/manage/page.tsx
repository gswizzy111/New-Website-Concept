import { ManageSubscription } from "./manage-subscription";

// Rendered on the server, so the heading and the form show before any script
// loads. The emailed link's token comes in the address (?token=...).
export default async function ManageSubscriptionPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { token } = await searchParams;
  return <ManageSubscription token={typeof token === "string" ? token : ""} />;
}
