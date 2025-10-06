import { Injectable } from '@nestjs/common';

@Injectable()
export class CurrencyService {
  // Mock exchange rates to EGP
  private readonly exchangeRates: Record<string, number> = {
    EGP: 1.0,
    USD: 49.0, // 1 USD = 49 EGP
    EUR: 53.0, // 1 EUR = 53 EGP
    GBP: 62.0, // 1 GBP = 62 EGP
    SAR: 13.0, // 1 SAR = 13 EGP
    AED: 13.3, // 1 AED = 13.3 EGP
  };

  /**
   * Convert amount from source currency to target currency
   * @param amount - Amount to convert
   * @param fromCurrency - Source currency code
   * @param toCurrency - Target currency code (default: EGP)
   * @returns Converted amount
   */
  convert(
    amount: number,
    fromCurrency: string,
    toCurrency: string = 'EGP',
  ): number {
    const from = fromCurrency.toUpperCase();
    const to = toCurrency.toUpperCase();

    if (!this.exchangeRates[from]) {
      throw new Error(`Unsupported currency: ${from}`);
    }

    if (!this.exchangeRates[to]) {
      throw new Error(`Unsupported currency: ${to}`);
    }

    // Convert to EGP first, then to target currency
    const amountInEGP = amount * this.exchangeRates[from];
    const convertedAmount = amountInEGP / this.exchangeRates[to];

    // Round to 2 decimal places
    return Math.round(convertedAmount * 100) / 100;
  }

  /**
   * Convert amount to EGP
   * @param amount - Amount to convert
   * @param fromCurrency - Source currency code
   * @returns Amount in EGP
   */
  toEGP(amount: number, fromCurrency: string): number {
    return this.convert(amount, fromCurrency, 'EGP');
  }

  /**
   * Get supported currencies
   * @returns Array of supported currency codes
   */
  getSupportedCurrencies(): string[] {
    return Object.keys(this.exchangeRates);
  }
}
