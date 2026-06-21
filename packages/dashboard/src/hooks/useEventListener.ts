import { useEffect, useRef } from "react";
import {
  subscribe,
  type DashboardEvent,
  type DashboardEventType,
} from "../lib/eventBus";

/**
 * Subscribe to a dashboard event. The listener is stored in a ref so the
 * subscription doesn't tear down on every render (which would cause a brief
 * window where events are missed).
 */
export function useEventListener(
  type: DashboardEventType,
  listener: (event: DashboardEvent) => void
): void {
  const ref = useRef(listener);
  ref.current = listener;
  useEffect(() => {
    return subscribe(type, (event) => ref.current(event));
  }, [type]);
}
