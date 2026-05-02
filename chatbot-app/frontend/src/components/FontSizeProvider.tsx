'use client';

import React, { createContext, useContext, useEffect, useState } from 'react';

export type FontSize = 'small' | 'medium' | 'large';

const FONT_BASE_MAP: Record<FontSize, string> = {
  small: '14px',
  medium: '15.5px',
  large: '17px',
};

const STORAGE_KEY = 'app-font-size';

const FontSizeContext = createContext<{
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}>({
  fontSize: 'small',
  setFontSize: () => {},
});

export function useFontSize() {
  return useContext(FontSizeContext);
}

export function FontSizeProvider({ children }: { children: React.ReactNode }) {
  const [fontSize, setFontSizeState] = useState<FontSize>('small');
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY) as FontSize | null;
    if (stored && stored in FONT_BASE_MAP) {
      setFontSizeState(stored);
      document.documentElement.style.setProperty('--font-base', FONT_BASE_MAP[stored]);
    }
    setMounted(true);
  }, []);

  const setFontSize = (size: FontSize) => {
    setFontSizeState(size);
    localStorage.setItem(STORAGE_KEY, size);
    document.documentElement.style.setProperty('--font-base', FONT_BASE_MAP[size]);
  };

  if (!mounted) return <>{children}</>;

  return (
    <FontSizeContext.Provider value={{ fontSize, setFontSize }}>
      {children}
    </FontSizeContext.Provider>
  );
}
