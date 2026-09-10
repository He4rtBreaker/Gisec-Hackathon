"use client";

import { useCallback, useEffect, useRef, useState } from "react";

const KEY = "mizan.nav.collapsed";
const EVENT = "mizan:nav-collapsed";

function read(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * Shared collapsed state for the left navigation. Persists to localStorage and
 * keeps every mounted consumer (the aside and its floating toggle) in sync
 * through a window event, so the two never disagree.
 */
export function useSidebarCollapsed(): [boolean, () => void] {
  const [collapsed, setCollapsed] = useState(false);
  const ref = useRef(false);

  useEffect(() => {
    const sync = () => {
      const v = read();
      ref.current = v;
      setCollapsed(v);
    };
    sync();
    window.addEventListener(EVENT, sync);
    window.addEventListener("storage", sync);
    return () => {
      window.removeEventListener(EVENT, sync);
      window.removeEventListener("storage", sync);
    };
  }, []);

  // Only ever called from a click handler — never during render.
  const toggle = useCallback(() => {
    const next = !ref.current;
    try {
      localStorage.setItem(KEY, next ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);

  return [collapsed, toggle];
}
