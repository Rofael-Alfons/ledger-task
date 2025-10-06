import { HttpException, HttpStatus } from '@nestjs/common';

export class WalletNotFoundException extends HttpException {
  constructor(walletId: string) {
    super(
      {
        statusCode: HttpStatus.NOT_FOUND,
        message: `Wallet with ID ${walletId} not found`,
        error: 'WALLET_NOT_FOUND',
      },
      HttpStatus.NOT_FOUND,
    );
  }
}
