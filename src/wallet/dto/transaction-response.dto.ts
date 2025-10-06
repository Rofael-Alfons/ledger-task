import { TransactionType } from '../enums/transaction-type.enum';

export class TransactionResponseDto {
  id: string;
  transactionId: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  convertedAmount: number;
  metadata?: Record<string, any>;
  createdAt: Date;
}
