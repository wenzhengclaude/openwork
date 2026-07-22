import { memo, useCallback } from "react";
import { ArrowDownToLine, ArrowUpToLine } from "lucide-react";

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import {
  selectSessionIsStickyBottom,
  selectSessionTopClippedMessageId,
  useSessionScrollStore,
} from "./scroll-store";

function useSessionScrollOverlayState(sessionId: string) {
  const isAtBottom = useSessionScrollStore((state) => selectSessionIsStickyBottom(state.sessions, sessionId));
  const topClippedMessageId = useSessionScrollStore((state) => selectSessionTopClippedMessageId(state.sessions, sessionId));

  return { isAtBottom, topClippedMessageId };
}

const jumpButtonClass =
  "flex size-8 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-dls-hover hover:text-dls-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

type JumpToStartButtonProps = {
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

const JumpToStartButton = memo(function JumpToStartButton({
  onJumpToStartOfMessage,
}: JumpToStartButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToStartOfMessage("smooth");
  }, [onJumpToStartOfMessage]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={jumpButtonClass}
            aria-label="Jump to start"
            title="Jump to start"
            onClick={handleClick}
          >
            <ArrowUpToLine className="size-4" />
          </button>
        }
      />
      <TooltipContent>Jump to start</TooltipContent>
    </Tooltip>
  );
});

type JumpToLatestButtonProps = {
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
};

const JumpToLatestButton = memo(function JumpToLatestButton({
  onJumpToLatest,
}: JumpToLatestButtonProps) {
  const handleClick = useCallback(() => {
    onJumpToLatest("smooth");
  }, [onJumpToLatest]);

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            className={jumpButtonClass}
            aria-label="Jump to latest"
            title="Jump to latest"
            onClick={handleClick}
          >
            <ArrowDownToLine className="size-4" />
          </button>
        }
      />
      <TooltipContent>Jump to latest</TooltipContent>
    </Tooltip>
  );
});

type SessionScrollOverlayProps = {
  sessionId: string;
  isStreaming: boolean;
  onJumpToLatest: (behavior?: ScrollBehavior) => void;
  onJumpToStartOfMessage: (behavior?: ScrollBehavior) => void;
};

export const SessionScrollOverlay = memo(function SessionScrollOverlay({
  sessionId,
  isStreaming,
  onJumpToLatest,
  onJumpToStartOfMessage,
}: SessionScrollOverlayProps) {
  const { isAtBottom, topClippedMessageId } = useSessionScrollOverlayState(sessionId);
  const showJumpToStart = !isStreaming && Boolean(topClippedMessageId);
  const showJumpToLatest = !isAtBottom;

  if (!showJumpToStart && !showJumpToLatest) {
    return null;
  }

  return (
    <div className="pointer-events-none absolute bottom-2 left-1/2 z-30 flex -translate-x-1/2 justify-center">
      <div className="pointer-events-auto flex items-center gap-1 rounded-full border border-dls-border bg-dls-surface/95 p-1 shadow-(--dls-card-shadow) backdrop-blur-md">
        {showJumpToStart ? (
          <JumpToStartButton onJumpToStartOfMessage={onJumpToStartOfMessage} />
        ) : null}
        {showJumpToLatest ? (
          <JumpToLatestButton onJumpToLatest={onJumpToLatest} />
        ) : null}
      </div>
    </div>
  );
});
