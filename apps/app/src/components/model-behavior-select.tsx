"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { motion } from "motion/react";

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
  description?: string;
};

type ModelBehaviorSelectProps = {
  value: string | null;
  label: string;
  options?: ModelBehaviorOption[];
  onChange: (value: string | null) => void;
  disabled?: boolean;
};

function percentForIndex(index: number, itemCount: number) {
  if (itemCount < 2) return 0;
  return (index / (itemCount - 1)) * 100;
}

function indexForPercent(percent: number, itemCount: number) {
  if (itemCount < 2) return 0;
  return Math.round((percent / 100) * (itemCount - 1));
}

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

  const items = useMemo(
    () => options.flatMap((option) =>
      option.value ? [{ value: option.value, label: option.label, description: option.description }] : [],
    ),
    [options],
  );
  const rawValue = value ?? null;
  const selectedIndex = Math.max(0, items.findIndex((option) => option.value === rawValue));
  const selected = items[selectedIndex];
  const selectedPercent = percentForIndex(selectedIndex, items.length);
  const [position, setPosition] = useState(selectedPercent);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    if (!isDragging) setPosition(selectedPercent);
  }, [isDragging, selectedPercent]);

  if (items.length < 2 || !selected) {
    return null;
  }

  const visualIndex = indexForPercent(position, items.length);
  const visualSelected = items[visualIndex] ?? selected;
  const description = visualSelected.description ?? t("model_behavior.desc_generic", {
    label: visualSelected.label.toLowerCase(),
  });
  const updatePosition = (nextPosition: number) => {
    const boundedPosition = Math.min(100, Math.max(0, nextPosition));
    const nextIndex = indexForPercent(boundedPosition, items.length);
    const next = items[nextIndex];

    setPosition(boundedPosition);
    if (next && next.value !== selected.value) onChange(next.value);
  };
  const motionTransition = isDragging
    ? { duration: 0 }
    : { type: "spring" as const, stiffness: 420, damping: 34, mass: 0.45 };

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
      <PopoverContent side="top" sideOffset={12} align="start" className="w-80 max-w-[calc(100vw-2rem)] gap-5 rounded-[22px] border border-blue-6/60 bg-dls-surface p-5 shadow-[0_24px_60px_-34px_rgba(20,30,55,0.52)] sm:w-[26rem]">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <span className="block text-sm font-medium text-dls-text">
            {t("model_behavior.title_reasoning_effort")}
            </span>
            <motion.p
              key={visualSelected.value}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="mt-1 truncate text-xs text-gray-10"
            >
              {description}
            </motion.p>
          </div>
          <motion.span
            key={visualSelected.value}
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.16 }}
            className="shrink-0 text-base font-semibold text-blue-11"
          >
            {visualSelected.label}
          </motion.span>
        </div>
        <div className="relative h-12 touch-none select-none">
          <div className="absolute inset-x-0 top-1/2 h-2 -translate-y-1/2 overflow-hidden rounded-full bg-gray-4">
            <motion.div
              animate={{ width: `${position}%` }}
              transition={motionTransition}
              className="h-full rounded-full bg-[linear-gradient(90deg,#2563eb_0%,#0ea5a7_100%)]"
            />
          </div>
          <div aria-hidden className="pointer-events-none absolute inset-x-0 top-1/2 -translate-y-1/2">
            {items.map((option, index) => (
              <motion.span
                key={option.value}
                animate={{
                  backgroundColor: index <= visualIndex ? "rgb(37 99 235)" : "rgb(161 161 170)",
                  scale: index === visualIndex ? 1.15 : 1,
                }}
                transition={{ duration: 0.16 }}
                className="absolute size-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-dls-surface"
                style={{ left: `${percentForIndex(index, items.length)}%` }}
              />
            ))}
          </div>
          <motion.span
            aria-hidden
            animate={{ left: `${position}%`, scale: isDragging ? 1.12 : 1 }}
            transition={motionTransition}
            className="pointer-events-none absolute top-1/2 z-10 size-8 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-dls-surface bg-white shadow-[0_6px_18px_rgba(28,95,240,0.34)] dark:bg-gray-12"
          />
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={Math.round(position)}
            disabled={disabled}
            aria-label={t("model_behavior.title_reasoning_effort")}
            aria-valuetext={visualSelected.label}
            className="absolute inset-0 z-20 h-full w-full cursor-pointer opacity-0 disabled:cursor-not-allowed"
            onChange={(event) => updatePosition(event.currentTarget.valueAsNumber)}
            onPointerDown={() => setIsDragging(true)}
            onPointerUp={() => setIsDragging(false)}
            onPointerCancel={() => setIsDragging(false)}
            onBlur={() => setIsDragging(false)}
          />
        </div>
        <div className="flex items-center justify-between text-[11px] font-medium text-gray-10">
          <span>{items[0]?.label ?? t("model_behavior.label_fast")}</span>
          <span>{items.at(-1)?.label ?? t("model_behavior.label_maximum")}</span>
        </div>
      </PopoverContent>
    </Popover>
  );
}
