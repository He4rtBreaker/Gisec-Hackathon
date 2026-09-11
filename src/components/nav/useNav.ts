"use client";

import { useEffect, useReducer } from "react";

/**
 * Left-navigation state, shared across every consumer through one module-level
 * store (no prop drilling, no event bus).
 *
 * - `collapsed` — the pinned choice. Persisted to localStorage.
 * - `peek`      — a transient hover-reveal while collapsed. Never persisted.
 */

const KEY = "mizan.nav.collapsed";

interface NavState {
  collapsed: boolean;
  peek: boolean;
  /** false until just after mount, so the first localStorage correction doesn't slide. */
  animate: boolean;
}

let state: NavState = { collapsed: false, peek: false, animate: false };
const subscribers = new Set<() => void>();
let hydrated = false;

function emit() {
  for (const fn of subscribers) fn();
}

let closeTimer: ReturnType<typeof setTimeout> | null = null;

/** Reveal the collapsed sidebar. Cancels any pending close from a moment ago. */
export function peekOpen(): void {
  if (closeTimer) {
    clearTimeout(closeTimer);
    closeTimer = null;
  }
  navSet({ peek: true });
}

/** Hide the peeked sidebar after a short grace period — matches claude.ai's
 *  hover-intent: moving off the toggle onto the sidebar itself, or back again,
 *  doesn't flicker it shut. */
export function peekCloseSoon(delay = 350): void {
  if (closeTimer) clearTimeout(closeTimer);
  closeTimer = setTimeout(() => {
    navSet({ peek: false });
    closeTimer = null;
  }, delay);
}

export function navSet(patch: Partial<NavState>): void {
  state = { ...state, ...patch };
  if ("collapsed" in patch) {
    try {
      localStorage.setItem(KEY, state.collapsed ? "1" : "0");
    } catch {
      /* storage blocked */
    }
    if (!state.collapsed) state.peek = false;
  }
  emit();
}

export function useNav(): NavState {
  const [, force] = useReducer((n: number) => n + 1, 0);

  useEffect(() => {
    subscribers.add(force);

    if (!hydrated) {
      hydrated = true;
      try {
        state = { ...state, collapsed: localStorage.getItem(KEY) === "1" };
      } catch {
        /* storage blocked */
      }
      const t = setTimeout(() => {
        state = { ...state, animate: true };
        emit();
      }, 60);
      emit();
      return () => {
        clearTimeout(t);
        subscribers.delete(force);
      };
    }

    force();
    return () => {
      subscribers.delete(force);
    };
  }, []);

  return state;
}
