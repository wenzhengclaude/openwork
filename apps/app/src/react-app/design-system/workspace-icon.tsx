/** @jsxImportSource react */

import { Folder } from "lucide-react";

export type WorkspaceIconProps = {
  workspaceId: string;
  /** CSS size class, e.g. "size-4", "size-5.5". Defaults to "size-4". */
  sizeClass?: string;
};

export function WorkspaceIcon({ workspaceId: _workspaceId, sizeClass = "size-4" }: WorkspaceIconProps) {
  return <Folder className={`${sizeClass} shrink-0 text-muted-foreground`} />;
}
