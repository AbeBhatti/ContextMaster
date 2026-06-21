import { useEffect, useRef } from "react";
import { emit } from "../lib/eventBus";

/**
 * Wire window focus + Page Visibility 'visible' to fire `callback`. Also
 * emits a global 'focus' event so other listeners can refetch in parallel
 * without each individually subscribing to focus events.
 *
 * The callback is stored in a ref so the subscriptions only attach once per
 * mount, even if the caller passes a fresh inline function each render.
 */
export function useFocusRefetch(callback: () => void): void {
  const ref = useRef(callback);
  ref.current = callback;

  useEffect(() => {
    let lastBlurAt: number | null = null;
    const MIN_BLUR_MS = 1000; // Suppress chatter from quick alt-tabs.

    const onBlur = () => {
      lastBlurAt = Date.now();
    };
    const onFocus = () => {
      // Only refetch if the tab was actually away for a moment — clicking
      // back into the window after a 50ms blur isn't worth a refetch.
      if (lastBlurAt === null || Date.now() - lastBlurAt < MIN_BLUR_MS) return;
      lastBlurAt = null;
      ref.current();
      emit({ type: "focus" });
    };
    const onVisibility = () => {
      if (document.visibilityState === "visible") onFocus();
      else onBlur();
    };

    window.addEventListener("focus", onFocus);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, []);
}
