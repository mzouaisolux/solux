"use client";

/**
 * Save a Blob to disk, letting the user choose the folder + filename via the
 * native "Save As" dialog when the browser supports the File System Access API
 * (Chrome / Edge / Chromium). Falls back to the classic anchor download (the
 * file lands in the default Downloads folder) on Firefox / Safari, or when the
 * picker is unavailable / blocked.
 *
 * MUST be called from within a user-gesture handler. The picker also requires
 * the gesture to still be "active", so keep awaited work BEFORE this call
 * minimal (ideally just `pdf(...).toBlob()`); otherwise the browser may reject
 * the picker with a SecurityError — in which case we transparently fall back to
 * the anchor download so the user still gets their file.
 *
 * @returns true when written via the native picker, false when it went through
 *          the fallback OR the user cancelled the dialog.
 */
export async function saveBlobAs(
  blob: Blob,
  suggestedName: string
): Promise<boolean> {
  const picker = (window as unknown as { showSaveFilePicker?: unknown })
    .showSaveFilePicker;
  if (typeof picker === "function") {
    try {
      const handle = await (picker as (opts: unknown) => Promise<any>).call(
        window,
        {
          suggestedName,
          types: [
            {
              description: "PDF document",
              accept: { "application/pdf": [".pdf"] },
            },
          ],
        }
      );
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return true;
    } catch (err: any) {
      // User cancelled the dialog → respect that, do NOT also dump the file
      // into Downloads.
      if (err?.name === "AbortError") return false;
      // Any other failure (picker blocked, gesture lost, etc.) → fall through
      // to the classic download so the user still gets their file.
    }
  }
  // Fallback — classic anchor download into the default Downloads folder.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return false;
}
