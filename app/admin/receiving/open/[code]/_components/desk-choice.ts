import { useSyncExternalStore } from "react";

/**
 * The desk this phone moves cards to (the scan landing's desk picker), kept
 * in localStorage by its code (LOC-DESK-GAVIN). Read with
 * useSyncExternalStore: nothing on the server's first render (the default
 * desk), then the kept choice. A browser that refuses storage (private mode)
 * keeps it for this page view only.
 */

const KEY = "intake.openPage.desk";
const listeners = new Set<() => void>();
let memory = "";

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? memory;
  } catch {
    return memory;
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  // Another tab picked a desk
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

/** The kept desk code ("" when none). */
export function useStoredDesk(): string {
  return useSyncExternalStore(subscribe, read, () => "");
}

export function storeDesk(code: string) {
  memory = code;
  try {
    localStorage.setItem(KEY, code);
  } catch {
    // not kept past this page view
  }
  for (const l of listeners) l();
}
