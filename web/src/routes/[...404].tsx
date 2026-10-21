import { A } from "@solidjs/router";

export default function NotFound() {
  return (
    <div class="grid flex-1 place-items-center px-6">
      <div class="text-center">
        <p class="font-mono text-4xl font-semibold text-stone-700">404</p>
        <p class="mt-2 text-sm text-stone-400">This page does not exist.</p>
        <A href="/" class="btn btn-primary mt-5">
          Back to databases
        </A>
      </div>
    </div>
  );
}
