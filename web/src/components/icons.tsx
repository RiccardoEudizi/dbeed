import type { JSX } from "solid-js";

type IconProps = JSX.SvgSVGAttributes<SVGSVGElement> & { size?: number };

function icon(props: IconProps, children: JSX.Element) {
  const { size = 16, class: className, ...rest } = props;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.75"
      stroke-linecap="round"
      stroke-linejoin="round"
      class={className}
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const DatabaseIcon = (p: IconProps) =>
  icon(p, <><ellipse cx="12" cy="5" rx="8" ry="3" /><path d="M4 5v14c0 1.66 3.58 3 8 3s8-1.34 8-3V5" /><path d="M4 12c0 1.66 3.58 3 8 3s8-1.34 8-3" /></>);

export const PlayIcon = (p: IconProps) => icon(p, <path d="M7 4.5 19 12 7 19.5z" />);

export const StopIcon = (p: IconProps) => icon(p, <rect x="6" y="6" width="12" height="12" rx="1.5" />);

export const RestartIcon = (p: IconProps) =>
  icon(p, <><path d="M3 12a9 9 0 1 0 2.64-6.36" /><path d="M3 4v5h5" /></>);

export const TrashIcon = (p: IconProps) =>
  icon(p, <><path d="M4 7h16" /><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /><path d="M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12" /><path d="M10 11v5M14 11v5" /></>);

export const CopyIcon = (p: IconProps) =>
  icon(p, <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h8" /></>);

export const CheckIcon = (p: IconProps) => icon(p, <path d="m4 12.5 5 5L20 6.5" />);

export const TerminalIcon = (p: IconProps) =>
  icon(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m7 9 3 3-3 3M13 15h4" /></>);

export const TableIcon = (p: IconProps) =>
  icon(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18M9 10v10M3 15h18" /></>);

export const ChevronRightIcon = (p: IconProps) => icon(p, <path d="m9 6 6 6-6 6" />);
export const ChevronDownIcon = (p: IconProps) => icon(p, <path d="m6 9 6 6 6-6" />);

export const PlusIcon = (p: IconProps) => icon(p, <path d="M12 5v14M5 12h14" />);

export const RefreshIcon = (p: IconProps) =>
  icon(p, <><path d="M20 11a8 8 0 0 0-14.9-3M4 13a8 8 0 0 0 14.9 3" /><path d="M20 4v7h-7M4 20v-7h7" /></>);

export const SearchIcon = (p: IconProps) =>
  icon(p, <><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></>);

export const XIcon = (p: IconProps) => icon(p, <path d="M6 6l12 12M18 6 6 18" />);

export const LogsIcon = (p: IconProps) =>
  icon(p, <><path d="M5 3h11l4 4v14H5z" /><path d="M15 3v5h5M9 12h6M9 16h6" /></>);

export const DownloadIcon = (p: IconProps) =>
  icon(p, <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M4 20h16" /></>);

export const ClockIcon = (p: IconProps) =>
  icon(p, <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>);

export const AlertIcon = (p: IconProps) =>
  icon(p, <><path d="M12 3 2 20h20z" /><path d="M12 9v5M12 17.5v.5" /></>);

export const KeyIcon = (p: IconProps) =>
  icon(p, <><circle cx="8" cy="15" r="4" /><path d="m11 12 9-9M17 3h4v4" /></>);

export const LinkIcon = (p: IconProps) =>
  icon(p, <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 0 0-5.66-5.66l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 0 0 5.66 5.66l1.5-1.5" /></>);

export const SparkIcon = (p: IconProps) =>
  icon(p, <path d="m12 3 2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z" />);

export const SidebarIcon = (p: IconProps) =>
  icon(p, <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>);

export const ServerIcon = (p: IconProps) =>
  icon(p, <><rect x="3" y="4" width="18" height="7" rx="2" /><rect x="3" y="13" width="18" height="7" rx="2" /><path d="M7 7.5h.01M7 16.5h.01" /></>);

export function Spinner(props: { class?: string; size?: number }) {
  const size = props.size ?? 14;
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      class={`animate-spin ${props.class ?? ""}`}
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" stroke-width="2.5" opacity="0.25" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" />
    </svg>
  );
}
