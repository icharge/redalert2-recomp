import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  readLauncherTheme,
  writeLauncherTheme,
  type LauncherTheme,
} from "../storage/launcher-theme";
import "./surfaces.css";

interface LauncherAppearance {
  theme: LauncherTheme;
  setTheme(theme: LauncherTheme): void;
}
const Appearance = createContext<LauncherAppearance | null>(null);

/** The document scope includes Radix portals, nested utility dialogs and other routes. */
function ThemeOwner({ children }: { children: ReactNode }) {
  const [theme, update] = useState(readLauncherTheme);
  const setTheme = useCallback((next: LauncherTheme) => {
    update(next);
    writeLauncherTheme(next);
  }, []);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-launcher-theme");
    root.setAttribute("data-launcher-theme", theme);
    return () => {
      if (previous === null) root.removeAttribute("data-launcher-theme");
      else root.setAttribute("data-launcher-theme", previous);
    };
  }, [theme]);
  useLayoutEffect(() => {
    const root = document.documentElement;
    const previous = root.getAttribute("data-launcher-motion");
    const synchronize = () =>
      root.setAttribute("data-launcher-motion", document.hidden ? "paused" : "running");
    synchronize();
    document.addEventListener("visibilitychange", synchronize);
    return () => {
      document.removeEventListener("visibilitychange", synchronize);
      if (previous === null) root.removeAttribute("data-launcher-motion");
      else root.setAttribute("data-launcher-motion", previous);
    };
  }, []);
  const value = useMemo(() => ({ theme, setTheme }), [theme, setTheme]);
  return <Appearance.Provider value={value}>{children}</Appearance.Provider>;
}

export function LauncherThemeProvider({ children }: { children: ReactNode }) {
  const parent = useContext(Appearance);
  return parent ? children : <ThemeOwner>{children}</ThemeOwner>;
}

export function useLauncherTheme(): LauncherAppearance {
  const value = useContext(Appearance);
  if (!value) throw new Error("Launcher appearance requires LauncherThemeProvider.");
  return value;
}
