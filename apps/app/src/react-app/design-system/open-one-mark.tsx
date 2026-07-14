/** @jsxImportSource react */

import { cn } from "@/lib/utils";

export type OpenOneMarkProps = {
  className?: string;
};

export function OpenOneMark({ className }: OpenOneMarkProps) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative block shrink-0 overflow-hidden rounded-[30%] bg-[#071827] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.16),0_8px_18px_-12px_rgba(7,24,39,0.65)]",
        className,
      )}
    >
      <span className="absolute inset-0 bg-[radial-gradient(circle_at_72%_20%,rgba(250,204,21,0.9),transparent_15%),radial-gradient(circle_at_78%_86%,rgba(20,184,166,0.55),transparent_26%),linear-gradient(145deg,rgba(37,99,235,0.58),transparent_45%)]" />
      <span className="absolute inset-[19%] rounded-full border-[2px] border-white/88 border-r-white/25" />
      <span className="absolute right-[24%] top-[25%] h-[49%] w-[14%] rounded-full bg-cyan-200 shadow-[0_0_12px_rgba(103,232,249,0.42)]" />
      <span className="absolute bottom-[25%] right-[17%] h-[13%] w-[34%] rounded-full bg-cyan-200" />
    </span>
  );
}
