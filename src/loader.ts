// Purple indeterminate loader bar for headless CLI waits.
// Renders inline on stderr so stdout stays clean for scripting (connection strings).
// Silent when stderr is not a TTY.
//
// The bar itself is drawn offscreen in an OpenTUI framebuffer
// (`OptimizedBuffer`, 1 row) and then serialized to a single ANSI line:
// thin `─` rail, all-purple moving segment with soft (faded) edges.

const RESET = "\x1b[0m";
const DIM = "\x1b[38;2;100;90;130m";

// All-purple ramp: deep violet tail -> light lavender -> near-white head.
// No other hues; edge softness comes from blending toward the rail.
const TO: [number, number, number] = [124, 58, 237];
const FROM: [number, number, number] = [216, 180, 254];
const HEAD: [number, number, number] = [245, 243, 255];
const RAIL: [number, number, number] = [100, 90, 130];

type RGB = [number, number, number];

function lerp(a: RGB, b: RGB, t: number): RGB {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

// Framebuffer drawing: color + soft alpha (0..1) for one cell of the
// moving segment. `k` is the index inside the block, `0 <= k < block`.
// Alpha peaks at the block center and dissolves at both edges; the shade
// stays inside the purple family (TO -> HEAD by center proximity).
export function barCell(k: number, block: number): { color: RGB; alpha: number } {
  const t = block <= 1 ? 1 : k / (block - 1);
  void t;
  const center = Math.sin((Math.PI * (k + 0.5)) / block); // 0 at edges, 1 center
  const alpha = Math.pow(center, 0.9);
  const shade = lerp(TO, HEAD, Math.pow(center, 1.2));
  return { color: lerp(RAIL, shade, alpha), alpha };
}

function fg([r, g, b]: RGB): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

interface CapturedSpanLike {
  text: string;
  fg: { buffer: ArrayLike<number> };
}

function spansToAnsi(spans: CapturedSpanLike[]): string {
  let out = "";
  for (const s of spans) {
    const r = s.fg.buffer[0] ?? 255;
    const g = s.fg.buffer[1] ?? 255;
    const b = s.fg.buffer[2] ?? 255;
    out += `\x1b[38;2;${r};${g};${b}m${s.text}`;
  }
  return out;
}

class Bar {
  private timer?: ReturnType<typeof setInterval>;
  private pos = 0;
  private dir = 1;
  private status = "";
  private startedAt = 0;
  // Lazily created so non-TTY runs never pay the @opentui/core import cost.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private fb?: any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private RGBA?: any;

  constructor(
    private label: string,
    private width = 20,
    private block = 7,
  ) {}

  setStatus(s: string) {
    this.status = s;
  }

  async start() {
    if (this.timer) return;
    const core = await import("@opentui/core");
    this.RGBA = core.RGBA;
    const fb = core.OptimizedBuffer.create(this.width, 1, "unicode", {
      id: "dbeed-loader",
      respectAlpha: true,
    });
    this.fb = fb;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), 70);
    this.tick();
  }

  private tick() {
    if (!this.fb || !this.RGBA) return;
    const { fb, RGBA } = this;
    const transparent = RGBA.fromInts(0, 0, 0, 0);
    const rail = RGBA.fromInts(RAIL[0], RAIL[1], RAIL[2], 255);
    fb.clear(transparent);
    for (let i = 0; i < this.width; i++) {
      fb.setCell(i, 0, "─", rail, transparent);
    }
    // Direction-aware head: the leading edge gets the brightest center.
    for (let k = 0; k < this.block; k++) {
      const kk = this.dir > 0 ? k : this.block - 1 - k;
      const idx = this.pos + k;
      if (idx < 0 || idx >= this.width) continue;
      const { color } = barCell(kk, this.block);
      fb.setCell(idx, 0, "─", RGBA.fromInts(color[0], color[1], color[2], 255), transparent);
    }
    const spans = fb.getSpanLines()[0]?.spans ?? [];
    const cells = spansToAnsi(spans);
    this.pos += this.dir;
    if (this.pos + this.block >= this.width || this.pos <= 0) this.dir *= -1;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const suffix = this.status ? ` · ${this.status.slice(0, 60)}` : "";
    process.stderr.write(`\r${cells}${RESET} ${this.label}${suffix} ${DIM}${elapsed}s${RESET}`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    try {
      this.fb?.destroy();
    } catch {}
    this.fb = undefined;
    process.stderr.write("\r\x1b[K");
  }
}

export interface LoaderCtl {
  /** Update the trailing status text shown on the loader line. */
  status: (s: string) => void;
}

export async function withLoader<T>(
  label: string,
  fn: (ctl: LoaderCtl) => Promise<T>,
  opts?: { immediate?: boolean },
): Promise<T> {
  if (!process.stderr.isTTY) return fn({ status: () => {} });
  const bar = new Bar(label);
  let shown = false;
  const t = setTimeout(
    () => {
      shown = true;
      void bar.start();
    },
    opts?.immediate ? 0 : 250,
  );
  try {
    return await fn({ status: (s) => bar.setStatus(s) });
  } finally {
    clearTimeout(t);
    if (shown) bar.stop();
  }
}

/**
 * Pump a child stream chunk-by-chunk, calling onLine with the latest
 * non-empty line. Splits on newlines and carriage returns so progress
 * output (pacman/apt) collapses onto the loader line instead of scrolling.
 */
export async function forwardLines(
  stream: ReadableStream<Uint8Array> | null | undefined,
  onLine: (line: string) => void,
): Promise<void> {
  if (!stream) return;
  const decoder = new TextDecoder();
  let buf = "";
  const flush = () => {
    const line = buf.trim();
    buf = "";
    if (line) onLine(line);
  };
  for await (const chunk of stream as AsyncIterable<Uint8Array>) {
    buf += decoder.decode(chunk, { stream: true });
    // split on \n or \r (progress bars rewrite with \r)
    const parts = buf.split(/[\r\n]+/);
    buf = parts.pop() ?? "";
    for (const p of parts) {
      const line = p.trim();
      if (line) onLine(line);
    }
  }
  buf += decoder.decode();
  flush();
}
