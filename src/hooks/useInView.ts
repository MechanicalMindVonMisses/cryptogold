"use client";

import { useEffect, useRef, useState } from "react";

/** Becomes true once the element has scrolled into view (and stays true). Used to lazy-load sparklines. */
export function useInView<T extends Element>(rootMargin = "100px") {
  const ref = useRef<T | null>(null);
  // Without IntersectionObserver (old browsers, tests) everything counts as visible.
  const [inView, setInView] = useState(() => typeof IntersectionObserver === "undefined");
  useEffect(() => {
    const el = ref.current;
    if (!el || inView) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setInView(true);
          io.disconnect();
        }
      },
      { rootMargin },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [inView, rootMargin]);
  return { ref, inView };
}
