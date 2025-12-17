/**
 * Sleep utility function
 * Pauses execution for the specified duration
 *
 * @param ms - Duration to sleep in milliseconds
 * @returns Promise that resolves after the specified duration
 *
 * @example
 * await sleep(1000); // Wait 1 second
 * await sleep(5000); // Wait 5 seconds
 */
export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
