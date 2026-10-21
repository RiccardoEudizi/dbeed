export function StatusBadge(props: { status: string }) {
  const running = () => props.status === "running";
  return (
    <span
      class="badge"
      classList={{
        "border-emerald-500/25 bg-emerald-500/10 text-emerald-300": running(),
        "border-ink-600 bg-ink-800 text-stone-500": !running(),
      }}
    >
      <span
        class="h-1.5 w-1.5 rounded-full"
        classList={{ "bg-emerald-400": running(), "bg-stone-600": !running() }}
      />
      {props.status || "unknown"}
    </span>
  );
}
