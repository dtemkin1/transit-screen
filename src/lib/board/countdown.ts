import type { Departure } from '../types';

const WINDOW_SEC = 60 * 60;
const BRD_ARR_GRACE_SEC = 30;

/**
 * Countdown text for a departure, or null when it should not be shown. An MBTA status
 * ("Stopped 5 stops away") is shown beside the countdown by the board, never instead of it.
 */
export function countdownLabel(d: Departure, nowMs: number): string | null {
  const sec = (d.departureTime - nowMs) / 1000;
  if (sec > WINDOW_SEC) return null;

  const subway = d.mode === 'subway';
  // BRD/ARR describe a live vehicle, and only shortly past its departure time.
  const realtime = subway && d.live && sec >= -BRD_ARR_GRACE_SEC;
  const boarding = realtime && d.vehicleStoppedHere === true && sec <= 90;
  const arriving = realtime && d.arrivalTime !== undefined && (d.arrivalTime - nowMs) / 1000 <= 30;
  if (sec < 0 && !boarding && !arriving) return null;

  if (boarding) return 'BRD';
  if (arriving) return 'ARR';
  if (sec < 60) return subway ? '1 min' : 'Now';
  return `${Math.floor(sec / 60)} min`;
}
