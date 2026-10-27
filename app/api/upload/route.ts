import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Card photo uploads (checkout, add-cards, the account card editor, admin).
 * No sign-in: customers upload photos before they have an order. Only the
 * image formats the uploaders accept get through, up to 20 MB: the POST
 * checks the file's own bytes, and the card-photos bucket enforces the same
 * types (as declared by the upload) and size on direct (signed URL) uploads
 * (supabase/migrations/20261027_security_data.sql). The bucket also takes
 * application/octet-stream, only for the old site's untyped uploads (served
 * as a download, never rendered); this route never stores or signs for it.
 */
const MAX_BYTES = 20 * 1024 * 1024; // 20 MB, same as the bucket's limit

// Stored name extension for each allowed type
const EXT_FOR_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
};

const TYPE_ERROR = "Only image files are allowed.";
const tooLarge = (bytes: number) =>
  `File too large (${(bytes / 1024 / 1024).toFixed(1)} MB). Maximum is 20 MB.`;

/** The image type a file's first bytes show, or null for anything else. */
function sniffImageType(b: Uint8Array): string | null {
  const ascii = (from: number, to: number) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.length >= 8 && b[0] === 0x89 && ascii(1, 4) === "PNG" && b[4] === 0x0d && b[5] === 0x0a && b[6] === 0x1a && b[7] === 0x0a) return "image/png";
  if (b.length >= 6 && (ascii(0, 6) === "GIF87a" || ascii(0, 6) === "GIF89a")) return "image/gif";
  if (b.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") return "image/webp";
  // ISO media files (AVIF, HEIC/HEIF): an "ftyp" box naming the brand
  if (b.length >= 12 && ascii(4, 8) === "ftyp") {
    const brand = ascii(8, 12);
    if (brand === "avif" || brand === "avis") return "image/avif";
    if (["heic", "heix", "hevc", "hevx", "heim", "heis"].includes(brand)) return "image/heic";
    if (brand === "mif1" || brand === "msf1") return "image/heif";
  }
  return null;
}

export async function POST(request: Request) {
  // Refuse an oversized body before reading it
  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BYTES + 64 * 1024) {
    return Response.json({ error: tooLarge(declared) }, { status: 413 });
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) return Response.json({ error: "Invalid request" }, { status: 400 });

  const file = formData.get("file");
  if (!file || typeof file === "string") return Response.json({ error: "No file provided" }, { status: 400 });

  if (file.size > MAX_BYTES) {
    return Response.json({ error: tooLarge(file.size) }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  // Any image format the uploaders take (JPEG, PNG, WEBP, GIF, AVIF, HEIC).
  // The bytes decide the type, never the file name or the browser's label.
  const contentType = sniffImageType(buffer.subarray(0, 32));
  if (!contentType) return Response.json({ error: TYPE_ERROR }, { status: 400 });
  const filename = `${crypto.randomUUID()}.${EXT_FOR_TYPE[contentType]}`;

  const admin = createAdminClient();
  const { error } = await admin.storage
    .from("card-photos")
    .upload(filename, buffer, { contentType, upsert: false });

  if (error) {
    console.error("Photo upload failed:", error.message);
    return Response.json({ error: "Upload failed. Please try again." }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from("card-photos").getPublicUrl(filename);
  return Response.json({ url: publicUrl });
}

// Presigned upload URL — client uploads directly to Supabase, bypassing Netlify body limits.
// Signed only for the image types above, up to 20 MB, which the bucket also
// enforces on the bytes sent to the signed URL (plus application/octet-stream,
// kept for the old site and never rendered). Anything else falls back to the POST.
export async function PUT(request: Request) {
  const body = await request.json().catch(() => null);
  if (!body?.filename) return Response.json({ error: "filename required" }, { status: 400 });

  const contentType = typeof body.contentType === "string" ? body.contentType.toLowerCase() : "";
  const ext = EXT_FOR_TYPE[contentType === "image/jpg" ? "image/jpeg" : contentType];
  if (!ext) {
    return Response.json({ error: TYPE_ERROR }, { status: 400 });
  }
  if (typeof body.size === "number" && body.size > MAX_BYTES) {
    return Response.json({ error: tooLarge(body.size) }, { status: 400 });
  }

  const filename = `${crypto.randomUUID()}.${ext}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage
    .from("card-photos")
    .createSignedUploadUrl(filename);

  if (error || !data) {
    console.error("Signed upload URL failed:", error?.message);
    return Response.json({ error: "Could not create upload URL" }, { status: 500 });
  }

  const { data: { publicUrl } } = admin.storage.from("card-photos").getPublicUrl(filename);
  return Response.json({ signedUrl: data.signedUrl, path: filename, publicUrl });
}
