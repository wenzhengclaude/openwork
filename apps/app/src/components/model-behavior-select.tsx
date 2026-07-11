"use client";

import { Slider } from "@base-ui/react/slider";
import { ChevronDown, Gauge } from "lucide-react";

import { t } from "@/i18n";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";

type ModelBehaviorOption = {
  value: string | null;
  label: string;
};

type ModelBehaviorSelectProps = {
  value: string | null;
  label: string;
  options?: ModelBehaviorOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

export function ModelBehaviorSelect({
  value,
  label,
  options,
  onChange,
  disabled = false,
}: ModelBehaviorSelectProps) {
  if (!options?.length) {
    return null;
  }

  const items = options.flatMap((option) =>
    option.value ? [{ value: option.value, label: option.label }] : [],
  );
  const rawValue = value ?? null;
  const selectedIndex = Math.max(0, items.findIndex((option) => option.value === rawValue));
  const selected = items[selectedIndex];

  if (items.length < 2 || !selected) {
    return null;
  }

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label={t("composer.behavior_label")}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-blue-6/60 bg-blue-2/50 px-2.5 text-xs font-medium text-blue-11 transition-colors hover:bg-blue-3 disabled:pointer-events-none disabled:opacity-60"
            >
              <Gauge className="size-3.5" />
              <span className="max-w-24 truncate">{selected.label || label}</span>
              <ChevronDown className="size-3.5" />
            </PopoverTrigger>
          }
        />
        <TooltipContent>{t("composer.behavior_label")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" sideOffset={10} align="start" className="w-80 gap-3 rounded-2xl border border-blue-6/50 bg-dls-surface p-4 shadow-[0_20px_60px_-32px_rgba(20,30,55,0.55)]">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-dls-text">
            {t("model_behavior.title_reasoning_effort")}
          </span>
          <span className="shrink-0 text-sm font-semibold text-blue-11">{selected.label}</span>
        </div>
        <Slider.Root
          min={0}
          max={items.length - 1}
          step={1}
          value={selectedIndex}
          disabled={disabled}
          onValueChange={(nextIndex) => {
            const next = items[nextIndex];
            if (next) onChange(next.value);
          }}
          className="relative flex h-8 w-full touch-none select-none items-center"
        >
          <Slider.Control className="relative h-2 w-full rounded-full bg-gray-4 outline-none">
            <Slider.Track className="h-full overflow-hidden rounded-full">
              <Slider.Indicator className="h-full rounded-full bg-blue-9" />
            </Slider.Track>
            {items.map((option, index) => (
              <span
                key={option.value}
                aria-hidden
                className={`pointer-events-none absolute top-1/2 size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-dls-surface ${index <= selectedIndex ? "bg-blue-9" : "bg-gray-7"}`}
                style={{ left: `${(index / (items.length - 1)) * 100}%` }}
              />
            ))}
            <Slider.Thumb
              className="size-5 rounded-full border-2 border-dls-surface bg-blue-9 shadow-[0_4px_12px_rgba(28,95,240,0.42)] outline-none transition-transform data-dragging:scale-110 data-[focus-visible]:ring-2 data-[focus-visible]:ring-blue-7 data-[focus-visible]:ring-offset-2 data-[focus-visible]:ring-offset-dls-surface"
              getAriaLabel={() => t("model_behavior.title_reasoning_effort")}
              getAriaValueText={() => selected.label}
            />
          </Slider.Control>
        </Slider.Root>
        <div className="flex items-center justify-between text-[11px] font-medium text-gray-10">
          <span>{t("model_behavior.label_fast")}</span>
          <span>{t("model_behavior.label_maximum")}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
