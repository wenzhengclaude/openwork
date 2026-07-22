/** @jsxImportSource react */
import { createContext, use, useCallback, useMemo, useState, type ReactNode } from "react";

import { t } from "@/i18n";
import { useDesktopConfig } from "@/react-app/domains/cloud/desktop-config-provider";
import { useLocal } from "@/react-app/kernel/local-provider";
import { notifyAlert } from "@/react-app/shell/notifications";
import type { ReleaseChannel } from "@/app/types";
import { useElectronUpdaterState } from "./electron-updater-state";

export const SETTINGS_UPDATE_AUTO_CHECK_KEY = "openwork.react.settings.update-auto-check";
export const SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY = "openwork.react.settings.update-auto-download";

function readStoredBoolean(key: string, fallback: boolean) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (raw == null) return fallback;
    return raw === "1";
  } catch {
    return fallback;
  }
}

function writeStoredBoolean(key: string, value: boolean) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, value ? "1" : "0");
  } catch {
    // ignore persistence failures
  }
}

type ElectronUpdaterContextValue = ReturnType<typeof useElectronUpdaterState> & {
  releaseChannel: ReleaseChannel;
  updateAutoCheck: boolean;
  updateAutoDownload: boolean;
  toggleUpdateAutoCheck: () => void;
  toggleUpdateAutoDownload: () => void;
  setReleaseChannel: (next: ReleaseChannel) => void;
};

const ElectronUpdaterContext = createContext<ElectronUpdaterContextValue | undefined>(undefined);

export function ElectronUpdaterProvider({ children }: { children: ReactNode }) {
  const local = useLocal();
  const desktopConfig = useDesktopConfig();
  const [updateAutoCheck, setUpdateAutoCheck] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, true),
  );
  const [updateAutoDownload, setUpdateAutoDownload] = useState(() =>
    readStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, true),
  );

  const releaseChannel = local.prefs.releaseChannel ?? "stable";
  const setReleaseChannel = useCallback(
    (next: ReleaseChannel) => {
      local.setPrefs((previous) => ({ ...previous, releaseChannel: next }));
    },
    [local],
  );

  const updater = useElectronUpdaterState({
    releaseChannel,
    onReleaseChannelChange: setReleaseChannel,
    updateAutoCheck,
    updateAutoDownload,
    desktopConfig: desktopConfig.config,
    setError: (message) => {
      if (!message) return;
      notifyAlert({
        kind: "update",
        title: t("notifications.updater_error"),
        body: message,
        dedupeKey: "updater-error",
      });
    },
  });

  const toggleUpdateAutoCheck = useCallback(() => {
    setUpdateAutoCheck((current) => {
      const next = !current;
      writeStoredBoolean(SETTINGS_UPDATE_AUTO_CHECK_KEY, next);
      return next;
    });
  }, []);

  const toggleUpdateAutoDownload = useCallback(() => {
    setUpdateAutoDownload((current) => {
      const next = !current;
      writeStoredBoolean(SETTINGS_UPDATE_AUTO_DOWNLOAD_KEY, next);
      return next;
    });
  }, []);

  const value = useMemo<ElectronUpdaterContextValue>(() => ({
    ...updater,
    releaseChannel,
    updateAutoCheck,
    updateAutoDownload,
    toggleUpdateAutoCheck,
    toggleUpdateAutoDownload,
    setReleaseChannel: updater.setReleaseChannel,
  }), [
    releaseChannel,
    toggleUpdateAutoCheck,
    toggleUpdateAutoDownload,
    updateAutoCheck,
    updateAutoDownload,
    updater,
  ]);

  return (
    <ElectronUpdaterContext.Provider value={value}>
      {children}
    </ElectronUpdaterContext.Provider>
  );
}

export function useElectronUpdater() {
  const context = use(ElectronUpdaterContext);
  if (!context) {
    throw new Error("useElectronUpdater must be used within an ElectronUpdaterProvider");
  }
  return context;
}
