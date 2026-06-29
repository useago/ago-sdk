import { useEffect, useRef, useState } from "react";

/**
 * Throttle a rapidly-changing string so an expensive downstream render (the
 * markdown parse) runs at most once every `delay` ms while the value keeps
 * changing, typically during token streaming.
 *
 * - The first value renders immediately, so static/finished content is never
 *   delayed by the throttle.
 * - While the value changes faster than `delay`, the returned value updates at
 *   most once per `delay` ms, keeping the previous value on screen in between.
 * - The latest value always lands once changes settle: whichever timer fires
 *   next reads the most recent value, so nothing is dropped.
 */
export function useThrottledStreamingContent(content: string, delay = 100): string {
  const [rendered, setRendered] = useState(content);
  const latestRef = useRef(content);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    latestRef.current = content;
    // Already showing the latest content — nothing to schedule.
    if (content === rendered) return;
    // Throttle: arm a timer only if none is pending. Whichever timer fires next
    // reads the most recent content via latestRef, so the final value is never
    // dropped even while changes keep arriving.
    if (timerRef.current === null) {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setRendered(latestRef.current);
      }, delay);
    }
  }, [content, rendered, delay]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    };
  }, []);

  return rendered;
}
