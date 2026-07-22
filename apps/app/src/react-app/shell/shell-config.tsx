/** @jsxImportSource react */
import { createContext, useCallback, use, useMemo, useState, type ReactNode } from "react";

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type ShellConfig = {
  /** Display name shown in the title bar, sidebar, and welcome page. */
  appName: string;
  /** Show the bottom status bar (connection status, docs, feedback). */
  statusBar: boolean;
  /** Show the left sidebar with workspace/session list. */
  sidebar: boolean;
  /** Show the Docs button in the status bar. */
  docsButton: boolean;
  /** Show the Feedback button in the status bar. */
  feedbackButton: boolean;
  /** Show the Cloud sign-in button when not signed in. */
  cloudSignin: boolean;
  /** Show the welcome/onboarding page for new users. */
  welcomePage: boolean;
  /** Show starter task cards in empty sessions. */
  starterCards: boolean;
  /** Show the model picker / model change UI. */
  modelPicker: boolean;
  /** Show the built-in browser panel. */
  browser: boolean;
  /** Show the "Add workspace" button. */
  addWorkspace: boolean;
  /** Show the notification bell in the header. */
  notifications: boolean;
};

/* ------------------------------------------------------------------ */
/*  Defaults                                                           */
/* ------------------------------------------------------------------ */

export const DEFAULT_SHELL_CONFIG: ShellConfig = {
  appName: "Open One",
  statusBar: true,
  sidebar: true,
  docsButton: false,
  feedbackButton: false,
  cloudSignin: true,
  welcomePage: true,
  starterCards: true,
  modelPicker: true,
  browser: true,
  addWorkspace: true,
  notifications: true,
};

/* ------------------------------------------------------------------ */
/*  Persistence                                                        */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "openwork.shell-config";
const STATUS_ACTIONS_HIDDEN_MIGRATION_KEY = "openwork.shell-config.status-actions-hidden.v1";

function markStatusActionsHiddenMigration(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STATUS_ACTIONS_HIDDEN_MIGRATION_KEY, "1");
  } catch {
    // Ignore storage errors.
  }
}

function readShellConfig(): ShellConfig {
  if (typeof window === "undefined") return DEFAULT_SHELL_CONFIG;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      markStatusActionsHiddenMigration();
      return DEFAULT_SHELL_CONFIG;
    }
    const parsed = JSON.parse(raw);
    const config = { ...DEFAULT_SHELL_CONFIG, ...parsed };
    if (!window.localStorage.getItem(STATUS_ACTIONS_HIDDEN_MIGRATION_KEY)) {
      const migrated = { ...config, docsButton: false, feedbackButton: false };
      writeShellConfig(migrated);
      markStatusActionsHiddenMigration();
      return migrated;
    }
    // Preserve a real custom name, but migrate the previous stock label.
    if (config.appName === "OpenWork") {
      const migrated = { ...config, appName: DEFAULT_SHELL_CONFIG.appName };
      writeShellConfig(migrated);
      return migrated;
    }
    return config;
  } catch {
    return DEFAULT_SHELL_CONFIG;
  }
}

function writeShellConfig(config: ShellConfig): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  } catch {
    // Ignore storage errors.
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

type ShellConfigContextValue = {
  config: ShellConfig;
  update: (patch: Partial<ShellConfig>) => void;
  reset: () => void;
};

const ShellConfigContext = createContext<ShellConfigContextValue | undefined>(undefined);

export function ShellConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ShellConfig>(readShellConfig);

  const update = useCallback((patch: Partial<ShellConfig>) => {
    setConfig((prev) => {
      const next = { ...prev, ...patch };
      writeShellConfig(next);
      return next;
    });
  }, []);

  const reset = useCallback(() => {
    setConfig(DEFAULT_SHELL_CONFIG);
    writeShellConfig(DEFAULT_SHELL_CONFIG);
  }, []);

  const value = useMemo<ShellConfigContextValue>(
    () => ({ config, update, reset }),
    [config, update, reset],
  );

  return (
    <ShellConfigContext.Provider value={value}>
      {children}
    </ShellConfigContext.Provider>
  );
}

export function useShellConfig(): ShellConfigContextValue {
  const ctx = use(ShellConfigContext);
  if (!ctx) {
    throw new Error("useShellConfig must be used within a ShellConfigProvider");
  }
  return ctx;
}
