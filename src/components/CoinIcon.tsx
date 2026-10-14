"use client";

import { useState } from "react";
import { cx } from "./ui/primitives";

/** Coin logo from CoinGecko, or a lettered disc when there is none. Decorative: names are always shown. */
export function CoinIcon({
  src,
  symbol,
  size = 20,
  className,
}: {
  src: string | null | undefined;
  symbol: string;
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  if (src && failed !== src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- remote CoinGecko thumbnails; no optimisation needed
      <img
        src={src}
        alt=""
        width={size}
        height={size}
        loading="lazy"
        onError={() => setFailed(src)}
        className={cx("shrink-0 rounded-full", className)}
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      style={{ width: size, height: size, fontSize: size * 0.45 }}
      className={cx(
        "inline-flex shrink-0 items-center justify-center rounded-full bg-surface-2 font-semibold text-muted",
        className,
      )}
    >
      {symbol.slice(0, 1)}
    </span>
  );
}
