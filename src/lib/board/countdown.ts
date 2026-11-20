import type { Departure } from '../types';

const WINDOW_SEC = 60 * 60;
const BRD_ARR_GRACE_SEC = 30;

// Countdown text, or null when the departure shouldn't show. MBTA status text goes beside it, never instead.
// Follows MBTA's real-time display guidelines: ARR, BRD and "Now" at their thresholds, minutes rounded half up.
export function countdownLabel(d: Departure, nowMs: number): string | null {
  const sec = (d.departureTime - nowMs) / 1000;
  if (sec > WINDOW_SEC) return null;

  const subway = d.mode === 'subway';
  /** Subway counts to the train's arrival when it's known, as MBTA's signs do; a bus counts to its departure. */
  const countSec = subway && d.arrivalTime !== undefined ? (d.arrivalTime - nowMs) / 1000 : sec;
  // BRD/ARR describe a live vehicle, and only shortly past its departure time.
  const realtime = subway && d.live && sec >= -BRD_ARR_GRACE_SEC;
  const arrived = realtime && d.arrivalTime !== undefined && d.arrivalTime <= nowMs && sec > 0;
  const boarding = realtime && ((d.vehicleStoppedHere === true && sec <= 90) || arrived);
  // Without an arrival time, a departure already past means the train has gone (MBTA skips these).
  const arriving = realtime && countSec <= 30 && (d.arrivalTime !== undefined || sec >= 0);
  if (sec < 0 && !boarding && !arriving) return null;

  if (boarding) return 'BRD';
  if (arriving) return 'ARR';
  if (!subway && sec <= 30) return 'Now';
  return `${Math.max(1, Math.round(countSec / 60))} min`;
}
