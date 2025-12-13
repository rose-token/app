import { useEffect, useState } from 'react';

/**
 * Hook to detect user's motion preferences for accessibility.
 * Respects the `prefers-reduced-motion` media query.
 *
 * @returns {boolean} prefersReducedMotion - True if user prefers reduced motion
 *
 * @example
 * const prefersReducedMotion = useReducedMotion();
 * const animationClass = prefersReducedMotion ? '' : 'animate-slide-up';
 */
export const useReducedMotion = () => {
  const [prefersReducedMotion, setPrefersReducedMotion] = useState(false);

  useEffect(() => {
    // Check if matchMedia is available (SSR safety)
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    setPrefersReducedMotion(mediaQuery.matches);

    const handleChange = (event) => {
      setPrefersReducedMotion(event.matches);
    };

    // Modern browsers
    if (mediaQuery.addEventListener) {
      mediaQuery.addEventListener('change', handleChange);
      return () => mediaQuery.removeEventListener('change', handleChange);
    }
    // Legacy browsers (Safari < 14)
    else if (mediaQuery.addListener) {
      mediaQuery.addListener(handleChange);
      return () => mediaQuery.removeListener(handleChange);
    }
    // Fallback: no listener support, no cleanup needed
    return undefined;
  }, []);

  return prefersReducedMotion;
};

export default useReducedMotion;
