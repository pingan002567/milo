/** 主题模式（照搬 stock-agent-001 useAppState 的主题机制）：
 * 白天 / 夜晚 / 跟随系统；模块加载时立即应用，防止启动闪错主题。 */
import { useCallback, useEffect, useState } from "react";

export type ThemeMode = "light" | "dark" | "system";
const THEME_KEY = "milo.theme";
const systemDarkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function getInitialThemeMode(): ThemeMode {
  try {
    const v = localStorage.getItem(THEME_KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* ignore */ }
  return "dark"; // Milo 默认深色（金融主题）；用户可切
}

function resolveDark(mode: ThemeMode): boolean {
  return mode === "dark" || (mode === "system" && systemDarkQuery.matches);
}

export function applyTheme(mode: ThemeMode): void {
  const dark = resolveDark(mode);
  document.documentElement.classList.toggle("dark", dark);
  document.documentElement.classList.toggle("light", !dark);
}

// 模块加载时立即应用（非 React 挂载后）
applyTheme(getInitialThemeMode());

export function useThemeMode() {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(getInitialThemeMode);

  useEffect(() => {
    applyTheme(themeMode);
    if (themeMode !== "system") return;
    const onChange = () => applyTheme("system");
    systemDarkQuery.addEventListener("change", onChange);
    return () => systemDarkQuery.removeEventListener("change", onChange);
  }, [themeMode]);

  const setThemeMode = useCallback((mode: ThemeMode) => {
    setThemeModeState(mode);
    try { localStorage.setItem(THEME_KEY, mode); } catch { /* ignore */ }
  }, []);

  return { themeMode, setThemeMode };
}
