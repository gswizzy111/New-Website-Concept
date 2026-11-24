import { useSyncExternalStore } from "react";
import type { LogItem } from "./views";

/**
 * What the Scan page keeps in the browser, read with useSyncExternalStore
 * (nothing on the server's first render, then the kept values):
 *  - this tab's list of saves and problems (sessionStorage, last 40),
 *  - the sound switch (localStorage, per browser),
 *  - this tab's scanning session id (sessionStorage; stored with each move).
 * A browser that refuses storage (private mode) just doesn't keep them.
 */

const LOG_KEY = "scan.log";
const SOUND_KEY = "scan.sound";
const SESSION_KEY = "scan.session";
const MAX_LOG = 40;
const NO_ITEMS: LogItem[] = [];

function store<T>(load: () => T, save: (value: T) => void, server: T) {
  let value: T | undefined;
  const listeners = new Set<() => void>();
  return {
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get(): T {
      if (value === undefined) value = load();
      return value;
    },
    server: () => server,
    set(next: T) {
      value = next;
      save(next);
      for (const l of listeners) l();
    },
  };
}

export const logStore = store<LogItem[]>(
  () => {
    try {
      const kept = JSON.parse(sessionStorage.getItem(LOG_KEY) ?? "[]");
      return Array.isArray(kept) ? (kept as LogItem[]).slice(0, MAX_LOG) : NO_ITEMS;
    } catch {
      return NO_ITEMS;
    }
  },
  (items) => {
    try {
      if (items.length) sessionStorage.setItem(LOG_KEY, JSON.stringify(items));
      else sessionStorage.removeItem(LOG_KEY);
    } catch {
      // not kept
    }
  },
  NO_ITEMS,
);

export function addLogItem(tone: LogItem["tone"], text: string) {
  const items = logStore.get();
  const id = items.reduce((max, i) => Math.max(max, i.id), 0) + 1;
  logStore.set([{ id, at: Date.now(), tone, text }, ...items].slice(0, MAX_LOG));
}

export const soundStore = store<boolean>(
  () => {
    try {
      return localStorage.getItem(SOUND_KEY) !== "off";
    } catch {
      return true;
    }
  },
  (on) => {
    try {
      localStorage.setItem(SOUND_KEY, on ? "on" : "off");
    } catch {
      // not remembered
    }
  },
  true,
);

export function useScanLog(): LogItem[] {
  return useSyncExternalStore(logStore.subscribe, logStore.get, logStore.server);
}

export function useSound(): boolean {
  return useSyncExternalStore(soundStore.subscribe, soundStore.get, soundStore.server);
}

let sessionId: string | null = null;

/** This tab's scanning session (a uuid), made on first use. */
export function scanSessionId(): string {
  if (sessionId) return sessionId;
  try {
    sessionId = sessionStorage.getItem(SESSION_KEY);
  } catch {
    // private mode
  }
  if (!sessionId) {
    try {
      sessionId = crypto.randomUUID();
    } catch {
      // crypto.randomUUID needs https; build a v4 uuid by hand
      const b = crypto.getRandomValues(new Uint8Array(16));
      b[6] = (b[6] & 0x0f) | 0x40;
      b[8] = (b[8] & 0x3f) | 0x80;
      const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
      sessionId = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    }
    try {
      sessionStorage.setItem(SESSION_KEY, sessionId);
    } catch {
      // not kept
    }
  }
  return sessionId;
}
