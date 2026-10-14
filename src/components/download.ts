export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Chart screenshot with a title band, so an exported PNG explains itself. */
export function composeChartPng(
  chart: HTMLCanvasElement,
  title: string,
  subtitle: string,
  colors: { bg: string; fg: string; muted: string },
): Promise<Blob | null> {
  const ratio = chart.width / Math.max(1, chart.clientWidth || chart.width);
  const band = Math.round(56 * ratio);
  const canvas = document.createElement("canvas");
  canvas.width = chart.width;
  canvas.height = chart.height + band;
  const ctx = canvas.getContext("2d");
  if (!ctx) return Promise.resolve(null);
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = colors.fg;
  ctx.font = `600 ${Math.round(16 * ratio)}px system-ui, sans-serif`;
  ctx.fillText(title, Math.round(16 * ratio), Math.round(24 * ratio));
  ctx.fillStyle = colors.muted;
  ctx.font = `${Math.round(12 * ratio)}px system-ui, sans-serif`;
  ctx.fillText(subtitle, Math.round(16 * ratio), Math.round(44 * ratio));
  ctx.drawImage(chart, 0, band);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"));
}
