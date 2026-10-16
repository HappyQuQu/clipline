import { useEffect } from 'react';
import { initializeTheme } from '../theme';

export default function useTheme(saved, preview, ready = true) {
  useEffect(() => {
    if (!ready) return;
    const theme = initializeTheme();
    theme.remember(saved);
    theme.setPreference(preview ?? saved);
  }, [saved, preview, ready]);
}
