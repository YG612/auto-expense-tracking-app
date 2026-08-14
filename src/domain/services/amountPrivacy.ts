import { formatAmountMinor } from './manualTransaction';

export const HIDDEN_AMOUNT_TEXT = '••••';

export function formatPrivateAmount(
  amountMinor: number,
  hideAmounts: boolean,
): string {
  return hideAmounts ? HIDDEN_AMOUNT_TEXT : formatAmountMinor(amountMinor);
}
