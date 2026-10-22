import { useSettings } from "@getpaseo/plugin/client";
import { useCallback, useEffect, useRef } from "react";

import { portSettings, type PortSettings } from "../shared/settings";

/** Typing saves once this long after the last change, so keystrokes don't race each other. */
const SAVE_DELAY_MS = 500;

type Patch = (current: PortSettings) => PortSettings;

export function usePortSettings() {
  const state = useSettings(portSettings);
  const values = state.status === "ready" ? state.values : null;
  const revision = state.status === "ready" ? state.revision : null;

  // The latest document and revision, read when a queued save runs.
  const latest = useRef({ state, values, revision });
  latest.current = { state, values, revision };
  const pending = useRef<Patch[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    timer.current = null;
    const { state: current, values: base, revision: rev } = latest.current;
    const patches = pending.current;
    if (!base || rev === null || patches.length === 0) return false;
    pending.current = [];
    return current.save(
      patches.reduce((next, patch) => patch(next), base),
      rev,
    );
  }, []);

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      void flush();
    },
    [flush],
  );

  /** Queues a change; changes made in quick succession are saved together. */
  const update = useCallback(
    (patch: Patch) => {
      pending.current.push(patch);
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(() => void flush(), SAVE_DELAY_MS);
    },
    [flush],
  );

  const setTarget = useCallback(
    (serverId: string, target: string) =>
      update((current) => {
        const targets = { ...current.targets };
        if (target.trim()) targets[serverId] = target.trim();
        else delete targets[serverId];
        return { ...current, targets };
      }),
    [update],
  );

  return { state, values, update, setTarget };
}
