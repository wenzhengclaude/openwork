import type { ComposerRunMode } from "./composer";

export const SET_COMPOSER_RUN_MODE_EVENT = "openwork:setComposerRunMode";

export type SetComposerRunModeEventDetail = {
  sessionId: string;
  mode: ComposerRunMode;
  focus?: boolean;
};

export function dispatchComposerRunModeChange(detail: SetComposerRunModeEventDetail) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent(SET_COMPOSER_RUN_MODE_EVENT, { detail }));
}
