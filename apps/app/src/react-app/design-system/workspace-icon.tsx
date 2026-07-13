/** @jsxImportSource react */

export type WorkspaceIconProps = {
  workspaceId: string;
  /** CSS size class, e.g. "size-4", "size-5.5". Defaults to "size-4". */
  sizeClass?: string;
};

export function WorkspaceIcon({ workspaceId: _workspaceId, sizeClass = "size-4" }: WorkspaceIconProps) {
  return (
    <img
      src="/open-one-mark.svg"
      alt=""
      aria-hidden="true"
      className={`${sizeClass} shrink-0`}
    />
  );
}
