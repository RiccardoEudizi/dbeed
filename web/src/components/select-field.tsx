import { Select } from "@kobalte/core/select";
import { CheckIcon, ChevronDownIcon } from "~/components/icons";

type Option<T extends string> = { value: T; label: string };

export function SelectField<T extends string>(props: {
  value?: T;
  onChange: (value: T) => void;
  options: Option<T>[];
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  class?: string;
  wrapperClass?: string;
}) {
  const selected = () => props.options.find((o) => o.value === props.value);
  return (
    <Select<Option<T>>
      class={`min-w-0 ${props.wrapperClass ?? "w-full"}`}
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      placeholder={props.placeholder}
      value={selected()}
      onChange={(option) => option && props.onChange(option.value)}
      disabled={props.disabled}
      disallowEmptySelection
      itemComponent={(itemProps) => (
        <Select.Item
          item={itemProps.item}
          class="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1.5 text-[13px] text-stone-300 outline-none select-none data-highlighted:bg-violet-500/15 data-highlighted:text-violet-100"
        >
          <Select.ItemLabel>{itemProps.item.rawValue.label}</Select.ItemLabel>
          <Select.ItemIndicator>
            <CheckIcon size={12} class="text-violet-300" />
          </Select.ItemIndicator>
        </Select.Item>
      )}
    >
      <Select.Trigger
        aria-label={props.ariaLabel}
        class={`input flex items-center justify-between text-left disabled:opacity-50 ${props.class ?? ""}`}
      >
        <Select.Value<Option<T>> class="truncate">
          {(state) => state.selectedOption()?.label ?? props.placeholder ?? ""}
        </Select.Value>
        <Select.Icon class="text-stone-500">
          <ChevronDownIcon size={13} />
        </Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Content class="z-100 max-h-[min(60dvh,320px)] min-w-[var(--kb-popper-anchor-width)] overflow-y-auto overscroll-contain rounded-lg border border-ink-600 bg-ink-850 p-1 shadow-2xl outline-none">
          <Select.Listbox />
        </Select.Content>
      </Select.Portal>
    </Select>
  );
}
