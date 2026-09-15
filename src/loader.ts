// Purple indeterminate loader bar for headless CLI waits.
// Renders on stderr so stdout stays clean for scripting (connection strings).
// Silent when stderr is not a TTY.

const RESET = "\x1b[0m";
const DIM = "\x1b[38;2;100;90;130m";

// Polished gradient glow bar: a bright head gliding over a purple gradient
// block on a dim rail, with elapsed time. All truecolor cells on stderr.
const HEAD: [number, number, number] = [245, 243, 255];
const FROM: [number, number, number] = [216, 180, 254];
const TO: [number, number, number] = [124, 58, 237];

function fg([r, g, b]: [number, number, number]): string {
  return `\x1b[38;2;${r};${g};${b}m`;
}

function lerp(a: [number, number, number], b: [number, number, number], t: number): [number, number, number] {
  return [
    Math.round(a[0] + (b[0] - a[0]) * t),
    Math.round(a[1] + (b[1] - a[1]) * t),
    Math.round(a[2] + (b[2] - a[2]) * t),
  ];
}

class Bar {
  private timer?: ReturnType<typeof setInterval>;
  private pos = 0;
  private dir = 1;
  private status = "";
  private startedAt = 0;

  constructor(
    private label: string,
    private width = 18,
    private block = 7,
  ) {}

  setStatus(s: string) {
    this.status = s;
  }

  start() {
    if (this.timer) return;
    this.startedAt = Date.now();
    this.timer = setInterval(() => this.tick(), 100);
    this.tick();
  }

  private tick() {
    let cells = "";
    for (let i = 0; i < this.width; i++) {
      if (i >= this.pos && i < this.pos + this.block) {
        // gradient tail -> bright head in the direction of travel
        const t = this.block <= 1 ? 1 : (i - this.pos) / (this.block - 1);
        const edge = this.dir > 0 ? t : 1 - t;
        const color = edge > 0.85 ? HEAD : lerp(FROM, TO, 1 - edge);
        cells += `${fg(color)}▀`;
      } else {
        cells += `${DIM}─`;
      }
    }
    this.pos += this.dir;
    if (this.pos + this.block >= this.width || this.pos <= 0) this.dir *= -1;
    const elapsed = ((Date.now() - this.startedAt) / 1000).toFixed(1);
    const suffix = this.status ? ` · ${this.status.slice(0, 60)}` : "";
    process.stderr.write(`\r${cells}${RESET} ${this.label}${suffix} ${DIM}${elapsed}s${RESET}`);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
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
      bar.start();
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
