import { themeLabel, useTheme } from "./theme.ts";

export function ThemeButton() {
  const { choice, resolved, cycle } = useTheme();
  return (
    <button type="button" className="theme-button" onClick={cycle}>
      {themeLabel({ choice, resolved })}
    </button>
  );
}
