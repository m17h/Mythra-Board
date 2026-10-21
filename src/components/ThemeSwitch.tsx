import type { ReactNode } from "react";
import { setThemeSetting, useTheme, type ThemeSetting } from "../theme";
import { AutoThemeIcon, MoonIcon, SunIcon } from "./icons";

const OPTIONS: [ThemeSetting, string, ReactNode][] = [
  ["system", "Match my Mac", <AutoThemeIcon key="a" />],
  ["light", "Light", <SunIcon key="l" />],
  ["dark", "Dark", <MoonIcon key="d" />],
];

/** Auto / Light / Dark picker. `labels` shows the names next to the icons. */
export function ThemeSwitch({ labels }: { labels?: boolean }) {
  const { setting } = useTheme();
  return (
    <div className={`theme-switch${labels ? " theme-switch--labels" : ""}`} role="radiogroup" aria-label="Appearance">
      {OPTIONS.map(([value, name, icon]) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={setting === value}
          aria-label={name}
          title={name}
          className={`theme-switch__item${setting === value ? " is-active" : ""}`}
          onClick={() => setThemeSetting(value)}
        >
          {icon}
          {labels && <span>{value === "system" ? "Auto" : name}</span>}
        </button>
      ))}
    </div>
  );
}
