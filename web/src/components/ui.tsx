import { Tooltip } from "@kobalte/core/tooltip";
import type { JSX } from "solid-js";

export function Tip(props: { label: string; children: JSX.Element }) {
  return (
    <Tooltip openDelay={400} closeDelay={60} placement="bottom">
      <Tooltip.Trigger as="span" class="inline-flex">
        {props.children}
      </Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content class="z-100 rounded-md border border-ink-600 bg-ink-800 px-2 py-1 text-[11px] text-stone-200 shadow-xl">
          {props.label}
          <Tooltip.Arrow />
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip>
  );
}

export function Kbd(props: { children: JSX.Element }) {
  return (
    <kbd class="rounded border border-ink-700 bg-ink-800 px-1.5 py-0.5 font-mono text-[10px] text-stone-400">
      {props.children}
    </kbd>
  );
}
