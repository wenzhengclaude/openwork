"use client";

import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, ChevronRight, Gauge } from "lucide-react";
import { motion, useMotionValue, useTransform, type Transition } from "motion/react";

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

type EffortTheme = {
  accent: string;
  track: string;
};

function getEffortTheme(value: string, label: string): EffortTheme {
  const effort = `${value} ${label}`.toLowerCase();

  if (/xhigh|max|maximum|最大|最高/.test(effort)) {
    return {
      accent: "#7c3aed",
      track: "linear-gradient(102deg, #5141d8 0%, #8c4bea 100%)",
    };
  }

  if (/high|deep|extended|高级|深度|扩展/.test(effort)) {
    return {
      accent: "#3b82f6",
      track: "linear-gradient(102deg, #3f8ff2 0%, #6baaf8 100%)",
    };
  }

  if (/medium|balanced|standard|中|标准/.test(effort)) {
    return {
      accent: "#0f8bc3",
      track: "linear-gradient(102deg, #238fd7 0%, #4dbbe8 100%)",
    };
  }

  return {
    accent: "#149b8b",
    track: "linear-gradient(102deg, #159a8c 0%, #3ac7ad 100%)",
  };
}

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
  const position = useMotionValue(selectedPercent);
  const fillWidth = useTransform(position, (current) => `${current}%`);
  const thumbLeft = useTransform(
    position,
    (current) => `calc(${current}% + ${0.625 - (1.25 * current) / 100}rem)`,
  );
  const rangeRef = useRef<HTMLInputElement>(null);
  const committedValueRef = useRef(selected?.value ?? null);
  const [visualIndex, setVisualIndex] = useState(selectedIndex);
  const [isDragging, setIsDragging] = useState(false);
  const [open, setOpen] = useState(false);

  useLayoutEffect(() => {
    if (isDragging) return;
    position.set(selectedPercent);
    setVisualIndex(selectedIndex);
    committedValueRef.current = selected?.value ?? null;
    if (rangeRef.current) rangeRef.current.value = String(Math.round(selectedPercent));
  }, [isDragging, position, selected?.value, selectedIndex, selectedPercent]);

  if (items.length < 2 || !selected) {
    return null;
  }

  const visualSelected = items[visualIndex] ?? selected;
  const effortTheme = getEffortTheme(visualSelected.value, visualSelected.label);
  const visibleParticleCount = Math.round(
    (percentForIndex(visualIndex, items.length) / 100) * energyParticles.length,
  );
  const updatePosition = (nextPosition: number) => {
    const boundedPosition = Math.min(100, Math.max(0, nextPosition));
    const nextIndex = indexForPercent(boundedPosition, items.length);
    const next = items[nextIndex];

    position.set(boundedPosition);
    if (nextIndex !== visualIndex) setVisualIndex(nextIndex);
    if (next && next.value !== committedValueRef.current) {
      committedValueRef.current = next.value;
      onChange(next.value);
    }
  };
  const motionTransition: Transition = isDragging
    ? { duration: 0 }
    : { type: "spring", stiffness: 410, damping: 30, mass: 0.55 };

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        if (nextOpen) {
          position.set(selectedPercent);
          setVisualIndex(selectedIndex);
          if (rangeRef.current) rangeRef.current.value = String(Math.round(selectedPercent));
        }
        setOpen(nextOpen);
      }}
    >
      <Tooltip>
        <TooltipTrigger
          render={
            <PopoverTrigger
              type="button"
              disabled={disabled}
              aria-label={t("composer.behavior_label")}
              className="inline-flex h-9 items-center gap-1.5 rounded-full bg-transparent px-2.5 text-sm font-medium text-gray-12 transition-colors hover:bg-gray-4 disabled:pointer-events-none disabled:opacity-60"
            >
              <Gauge className="size-3.5" style={{ color: effortTheme.accent }} />
              <span className="max-w-28 truncate" style={{ color: effortTheme.accent }}>{selected.label || label}</span>
              <ChevronDown className="size-4 text-gray-10" />
            </PopoverTrigger>
          }
        />
        <TooltipContent>{t("composer.behavior_label")}</TooltipContent>
      </Tooltip>
      <PopoverContent side="top" sideOffset={10} align="end" className="w-[22rem] max-w-[calc(100vw-2rem)] rounded-[20px] border border-gray-5 bg-dls-surface p-0 shadow-[0_20px_40px_-24px_rgba(19,18,41,0.38)]">
        <div className="px-5 pb-5 pt-4 sm:px-6">
          <motion.div
            key={visualSelected.value}
            initial={{ opacity: 0, y: 5, filter: "blur(4px)" }}
            animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
            transition={{ duration: 0.2 }}
            className="flex min-h-6 items-center gap-1 text-base font-medium"
          >
            <span
              className="inline-block"
              style={{
                color: effortTheme.accent,
              }}
            >
              {visualSelected.label}
            </span>
            <ChevronRight className="size-4 text-gray-9" />
          </motion.div>
          <div className="relative mt-4 h-12 touch-none select-none px-2.5">
            <div className="absolute inset-x-2.5 top-1/2 h-10 -translate-y-1/2 overflow-hidden rounded-full bg-gray-4">
              <motion.div
                aria-hidden
                initial={false}
                animate={{ backgroundPosition: ["0% 50%", "100% 50%", "0% 50%"] }}
                transition={{ backgroundPosition: { duration: 7, ease: "linear", repeat: Infinity } }}
                style={{ backgroundImage: effortTheme.track, width: fillWidth }}
                className="relative h-full overflow-hidden rounded-full bg-[length:180%_100%]"
              >
                <span className="absolute inset-0 bg-[linear-gradient(90deg,rgba(255,255,255,0.03),rgba(255,255,255,0.2),rgba(255,255,255,0.03))]" />
                {energyParticles.slice(0, visibleParticleCount).map((particle) => (
                  <motion.span
                    key={particle.left}
                    animate={{
                      opacity: [0.25, 0.95, 0.25],
                      x: [0, 10, 0],
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
            </div>
            <motion.span
              aria-hidden
              initial={false}
              animate={{ scale: isDragging ? 1.06 : 1 }}
              transition={motionTransition}
              style={{ left: thumbLeft }}
              className="pointer-events-none absolute top-1/2 z-10 size-12 -translate-x-1/2 -translate-y-1/2 rounded-full border border-gray-3 bg-dls-surface shadow-[0_4px_10px_rgba(51,37,115,0.2)]"
            >
              <motion.span
                animate={{ opacity: isDragging ? 0.18 : 0, scale: isDragging ? 1 : 0.7 }}
                transition={{ duration: 0.16 }}
                className="absolute inset-2 rounded-full border"
                style={{ borderColor: effortTheme.accent }}
              />
            </motion.span>
            <input
              ref={rangeRef}
              type="range"
              min="0"
              max="100"
              step="1"
              defaultValue={Math.round(selectedPercent)}
              disabled={disabled}
              aria-label={t("model_behavior.title_reasoning_effort")}
              aria-valuetext={visualSelected.label}
              className="absolute inset-x-2.5 inset-y-0 z-20 h-full w-[calc(100%-1.25rem)] cursor-pointer opacity-0 disabled:cursor-not-allowed"
              onInput={(event) => updatePosition(event.currentTarget.valueAsNumber)}
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
        </div>
      </PopoverContent>
    </Popover>
  );
}
