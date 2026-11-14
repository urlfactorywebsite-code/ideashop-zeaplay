export const COUNT_ROLL_SECONDS = .9;
export const countStagger = (index: number) => Math.min(Math.max(index, 0) * .008, .08);
export const validTaskCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

// Three decimal cycles bound the work independently of the size of the count.
// Normalizing an interrupted reel to the middle cycle preserves its exact image.
export function planCountReel(position: number, digit: number, direction: number, initial: boolean) {
  const start = 10 + ((position % 10) + 10) % 10;
  const target = direction < 0 ? Math.floor((start - digit) / 10) * 10 + digit
    : Math.ceil((start - digit) / 10) * 10 + digit + (initial && digit !== 0 ? 10 : 0);
  return { start, target };
}
