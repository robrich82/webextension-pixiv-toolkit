/** A frame whose delay isn't a positive number of ms (Pixiv always gives one) lasts this long. */
export const FALLBACK_DELAY = 100;

/**
 * @param {*} delay A frame's delay from the ugoira's metadata
 * @returns {number} The delay in ms, or FALLBACK_DELAY when it isn't a positive number
 */
export function frameDelay(delay) {
  return Number.isFinite(delay) && delay > 0 ? delay : FALLBACK_DELAY;
}
