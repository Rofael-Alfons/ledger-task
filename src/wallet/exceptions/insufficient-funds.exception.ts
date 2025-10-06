import { HttpException, HttpStatus } from '@nestjs/common';

export class InsufficientFundsException extends HttpException {
  constructor(balance: number, requested: number) {
    super(
      {
        statusCode: HttpStatus.BAD_REQUEST,
        message: 'Insufficient funds',
        error: 'INSUFFICIENT_FUNDS',
        details: {
          currentBalance: balance,
          requestedAmount: requested,
          shortfall: requested - balance,
        },
      },
      HttpStatus.BAD_REQUEST,
    );
  }
}
