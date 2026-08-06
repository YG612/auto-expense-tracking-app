let sequence = 0;

export function createId(prefix: string, now: number = Date.now()): string {
  sequence = (sequence + 1) % 1_000_000;
  const random = Math.floor(Math.random() * 0x1_0000_0000)
    .toString(36)
    .padStart(7, '0');

  return `${prefix}-${now.toString(36)}-${sequence.toString(36)}-${random}`;
}
