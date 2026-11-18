import type { Departure } from '../types';

const WINDOW_SEC = 60 * 60;

/** Countdown text for a departure, or null when it should not be shown. */
export function countdownLabel(d: Departure, nowMs: number): string | null {
  const sec = (d.departureTime - nowMs) / 1000;
  if (sec > WINDOW_SEC) return null;

  const subway = d.mode === 'subway';
  const boarding = subway && d.vehicleStoppedHere === true && sec <= 90;
  const arriving = subway && d.arrivalTime !== undefined && (d.arrivalTime - nowMs) / 1000 <= 30;
  if (sec < 0 && !boarding && !arriving) return null;

  if (d.status) return d.status;
  if (boarding) return 'BRD';
  if (arriving) return 'ARR';
  if (sec < 60) return subway ? '1 min' : 'Now';
  return `${Math.floor(sec / 60)} min`;
}
