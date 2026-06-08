"use client";

// =====================================================================
// DirtyContext — tracks unsaved changes across all TaskLineEditor instances
// so the Submit button can block, the page can warn on navigation, and
// future auto-save can iterate over registered save functions.
//
// Architecture: each TaskLineEditor calls registerLine() on mount and
// unregisterLine() on unmount. As the user edits, it calls setDirty(id, true)
// / setDirty(id, false). The Submit button reads hasAnyDirty and calls
// saveAll() for the "Save & Submit" flow.
// =====================================================================

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";

type SaveFn = () => Promise<void>;

type DirtyCtx = {
  /** Which line IDs currently have unsaved changes. */
  dirtySet: ReadonlySet<string>;
  hasAnyDirty: boolean;
  dirtyCount: number;
  /** Called by TaskLineEditor when its dirty state changes. */
  setDirty: (lineId: string, dirty: boolean) => void;
  /** Register a save function so saveAll() can trigger it. */
  registerSaveFn: (lineId: string, fn: SaveFn) => void;
  unregisterSaveFn: (lineId: string) => void;
  /** Save every dirty line, in parallel. */
  saveAll: () => Promise<void>;
};

const Ctx = createContext<DirtyCtx>({
  dirtySet: new Set(),
  hasAnyDirty: false,
  dirtyCount: 0,
  setDirty: () => {},
  registerSaveFn: () => {},
  unregisterSaveFn: () => {},
  saveAll: async () => {},
});

export function DirtyProvider({ children }: { children: ReactNode }) {
  const [dirtySet, setDirtySet] = useState<Set<string>>(new Set());
  // Save functions stay in a ref — never need to cause re-renders.
  const saveFnsRef = useRef<Map<string, SaveFn>>(new Map());

  const setDirty = useCallback((lineId: string, dirty: boolean) => {
    setDirtySet((prev) => {
      const next = new Set(prev);
      if (dirty) next.add(lineId);
      else next.delete(lineId);
      return next;
    });
  }, []);

  const registerSaveFn = useCallback((lineId: string, fn: SaveFn) => {
    saveFnsRef.current.set(lineId, fn);
  }, []);

  const unregisterSaveFn = useCallback((lineId: string) => {
    saveFnsRef.current.delete(lineId);
  }, []);

  const saveAll = useCallback(async () => {
    const dirty = Array.from(saveFnsRef.current.entries()).filter(([id]) =>
      dirtySet.has(id)
    );
    await Promise.all(dirty.map(([, fn]) => fn()));
  }, [dirtySet]);

  // Navigation protection — warn the browser before the user leaves the page.
  useEffect(() => {
    function onBeforeUnload(e: BeforeUnloadEvent) {
      if (dirtySet.size === 0) return;
      e.preventDefault();
      // Chrome requires returnValue to be set.
      e.returnValue = "";
    }
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [dirtySet]);

  return (
    <Ctx.Provider
      value={{
        dirtySet,
        hasAnyDirty: dirtySet.size > 0,
        dirtyCount: dirtySet.size,
        setDirty,
        registerSaveFn,
        unregisterSaveFn,
        saveAll,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}

export function useDirty() {
  return useContext(Ctx);
}
