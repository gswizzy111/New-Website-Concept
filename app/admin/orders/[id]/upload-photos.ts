/**
 * Upload photos one at a time through /api/upload. Failed files are counted
 * (with the first reason) instead of being dropped silently, and an error page
 * that isn't JSON (a phone photo over the size limit, say) can't leave the
 * uploader stuck.
 */
export async function uploadPhotos(files: File[]): Promise<{ urls: string[]; error: string | null }> {
  const urls: string[] = [];
  let failed = 0;
  let reason = "";
  for (const file of files) {
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/upload", { method: "POST", body: form });
      const data = await res.json().catch(() => ({}));
      if (res.ok && typeof data.url === "string") {
        urls.push(data.url);
      } else {
        failed++;
        reason ||= data.error ?? (res.status === 413 ? "File too large." : `Upload failed (${res.status}).`);
      }
    } catch {
      failed++;
      reason ||= "Network error.";
    }
  }
  if (!failed) return { urls, error: null };
  const what = files.length === 1 ? "The photo didn't upload" : `${failed} of ${files.length} photos didn't upload`;
  return { urls, error: `${what}: ${reason}` };
}
