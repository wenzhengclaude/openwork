"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronDown, Gauge } from "lucide-react";
import { motion, type Transition } from "motion/react";

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

const energyParticles = [
  { left: 8, top: 34, size: 3, delay: 0.1, duration: 2.8 },
  { left: 15, top: 63, size: 2, delay: 0.8, duration: 3.3 },
  { left: 25, top: 26, size: 2, delay: 0.4, duration: 2.5 },
  { left: 37, top: 56, size: 3, delay: 1.1, duration: 3.1 },
  { left: 47, top: 33, size: 2, delay: 0.2, duration: 2.7 },
  { left: 58, top: 66, size: 3, delay: 0.7, duration: 3.4 },
  { left: 69, top: 39, size: 2, delay: 1.2, duration: 2.6 },
  { left: 79, top: 60, size: 3, delay: 0.5, duration: 3 },
];

export function ModelBehaviorSelect({
  value,
  label,
  options,
  onChange,
  disabled = false,
}: ModelBehaviorSelectProps) {
  const items = useMemo(
    () => (options ?? []).flatMap((option) =>
      option.value
        ? [{ value: option.value, label: option.label, description: option.description }]
        : [],
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
  const motionTransition: Transition = isDragging
    ? { duration: 0 }
    : { type: "spring", stiffness: 410, damping: 30, mass: 0.55 };

  return (
    <Popover>
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label={t("composer.behavior_label")}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-gray-3 px-3 text-sm font-medium text-gray-12 transition-colors hover:bg-gray-4 disabled:pointer-events-none disabled:opacity-60"
            >
              <Gauge className="size-3.5 text-violet-10" />
              <span className="max-w-28 truncate text-violet-11">{selected.label || label}</span>
              <ChevronDown className="size-4 text-gray-10" />
            </PopoverTrigger>
          }
        />
        <TooltipContent>{t("composer.behavior_label")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" sideOffset={12} align="start" className="w-[28rem] max-w-[calc(100vw-2rem)] rounded-[22px] border border-gray-5 bg-dls-surface p-0 shadow-[0_22px_46px_-26px_rgba(19,18,41,0.38)]">
        <div className="px-6 pb-7 pt-5 sm:px-7">
          <motion.p
            key={visualSelected.value}
            initial={{ opacity: 0, y: 5, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.2 }}
            className="min-h-7 text-center text-xl font-medium text-transparent [background:linear-gradient(96deg,#4f46e5_0%,#a855f7_100%)] [-webkit-background-clip:text]"
          >
            {description}
          </motion.p>
          <div className="relative mt-5 h-14 touch-none select-none px-3">
            <motion.div
              aria-hidden
              animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
              transition={{ duration: 7, ease: "linear", repeat: Infinity }}
              className="absolute inset-x-3 top-1/2 h-12 -translate-y-1/2 overflow-hidden rounded-full bg-[length:180%_100%] [background-image:linear-gradient(102deg,#2f51d5_0%,#6444e7_46%,#a34ff7_100%)]"
            >
              <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.2),rgba(255,255,255,0.03))]" />
              {energyParticles.map((particle) => (
                <motion.span
                  key={particle.left}
                  animate={{
                    opacity: [0.25, 0.95, 0.25],
                    x: [0, 16, 0],
                    y: [0, -2, 0],
                    scale: [0.75, 1.2, 0.75],
                  }}
                  transition={{
                    duration: particle.duration,
                    delay: particle.delay,
                    ease: "easeInOut",
                    repeat: Infinity,
                  }}
                  className="absolute rounded-full bg-white/85 shadow-[0_0_8px_rgba(255,255,255,0.8)]"
                  style={{
                    left: `${particle.left}%`,
                    top: `${particle.top}%`,
                    width: particle.size,
                    height: particle.size,
                  }}
                />
              ))}
            </motion.div>
            <motion.span
              aria-hidden
              animate={{ left: `calc(0.75rem + (100% - 1.5rem) * ${position / 100})`, scale: isDragging ? 1.06 : 1 }}
              transition={motionTransition}
              className="pointer-events-none absolute top-1/2 z-10 size-14 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-3 bg-dls-surface shadow-[0_5px_12px_rgba(51,37,115,0.2)]"
            >
              <motion.span
                animate={{ opacity: isDragging ? 0.18 : 0, scale: isDragging ? 1 : 0.7 }}
                transition={{ duration: 0.16 }}
                className="absolute inset-2 rounded-full border border-violet-7"
              />
            </motion.span>
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={Math.round(position)}
              disabled={disabled}
              aria-label={t("model_behavior.title_reasoning_effort")}
              aria-valuetext={visualSelected.label}
              className="absolute inset-x-3 inset-y-0 z-20 h-full w-[calc(100%-1.5rem)] cursor-pointer opacity-0 disabled:cursor-not-allowed"
              onChange={(event) => updatePosition(event.currentTarget.valueAsNumber)}
              onPointerDown={(event) => {
                event.currentTarget.setPointerCapture(event.pointerId);
                setIsDragging(true);
              }}
              onPointerUp={(event) => {
                event.currentTarget.releasePointerCapture(event.pointerId);
                setIsDragging(false);
              }}
              onPointerCancel={() => setIsDragging(false)}
              onBlur={() => setIsDragging(false)}
            />
          </div>
          <div className="mt-3 flex justify-center">
            <motion.span
              key={visualSelected.value}
              initial={{ opacity: 0, y: 3 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.16 }}
              className="rounded-full bg-gray-3 px-4 py-1 text-sm font-medium text-violet-11"
            >
              {visualSelected.label}
            </motion.span>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
