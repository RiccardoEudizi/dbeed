// DB logo rendered with the actual OpenTUI ASCIIFont component
// (<ascii_font text="DB" font="tiny">), same as the TUI uses.
// Falls back to a static snapshot if rendering fails.

const PURPLE = "\x1b[38;2;168;85;247m";
const RESET = "\x1b[0m";

const FALLBACK = [
  "██████╗  ██████╗",
  "██╔══██╗ ██╔══██╗",
  "██║  ██║ ██████╔╝",
  "██║  ██║ ██╔══██╗",
  "██████╔╝ ██████╔╝",
  "╚═════╝  ╚═════╝",
];

async function renderLogo(): Promise<string[]> {
  const { testRender } = await import("@opentui/solid");
  const setup = await testRender(
    () => <ascii_font text="DB" font="block" />,
    { width: 24, height: 7 },
  );
  try {
    await setup.renderOnce();
    const lines = setup
      .captureCharFrame()
      .split("\n")
      .slice(0, 6)
      .map((l) => l.replace(/\s+$/, ""))
      .filter((l) => l.length > 0);
    return lines.length > 0 ? lines : FALLBACK;
  } finally {
    setup.renderer.destroy();
  }
}

/** Print the logo left-aligned to stderr. Silent when piped (script-safe). */
export async function printLogo() {
  if (!process.stderr.isTTY) return;
  let lines = FALLBACK;
  try {
    lines = await renderLogo();
  } catch {
    // static fallback
  }
  for (const line of lines) {
    process.stderr.write(`${PURPLE}${line}${RESET}\n`);
  }
}
