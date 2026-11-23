import { useEffect, useState } from 'react';

export type Theme = 'light' | 'dark';

const THEME_KEY = 'atendy:theme';

const readTheme = (): Theme => {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light';
  } catch {
    return 'light';
  }
};

/**
 * The panel's light/dark choice, remembered per browser (the admin shares it). It sits on `<html>` only while the
 * panel or the admin is mounted, so Clerk popovers follow it and the public menu and auth stay light.
 */
export const usePanelTheme = () => {
  const [theme, setTheme] = useState<Theme>(readTheme);

  useEffect(() => {
    const root = document.documentElement;

    root.dataset.theme = theme;

    return () => {
      delete root.dataset.theme;
    };
  }, [theme]);

  const choose = (next: Theme) => {
    setTheme(next);

    try {
      localStorage.setItem(THEME_KEY, next);
    } catch {
      // Private mode: the choice still holds for this visit.
    }
  };

  return { theme, setTheme: choose };
};
