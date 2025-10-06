import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import {
  Repository,
  DataSource,
  OptimisticLockVersionMismatchError,
} from 'typeorm';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';
import { CurrencyService } from '../currency/currency.service';
import { InsufficientFundsException } from './exceptions/insufficient-funds.exception';
import { WalletNotFoundException } from './exceptions/wallet-not-found.exception';
import { TransactionType } from './enums/transaction-type.enum';

@Injectable()
export class WalletService {
  private readonly logger = new Logger(WalletService.name);
  private readonly MAX_RETRIES = 3;

  constructor(
    @InjectRepository(Wallet)
    private readonly walletRepository: Repository<Wallet>,
    @InjectRepository(Transaction)
    private readonly transactionRepository: Repository<Transaction>,
    private readonly currencyService: CurrencyService,
    private readonly dataSource: DataSource,
  ) {}

  /**
   * Create a new transaction with ACID guarantees
   * Implements optimistic locking with retry mechanism
   */
  async createTransaction(
    dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    // Check idempotency - if transaction already exists, return it
    const existingTransaction = await this.transactionRepository.findOne({
      where: { transactionId: dto.transactionId },
    });

    if (existingTransaction) {
      this.logger.log(
        `Transaction ${dto.transactionId} already exists (idempotent)`,
      );
      return this.mapToResponseDto(existingTransaction);
    }

    // Attempt transaction with retry logic for optimistic lock failures
    for (let attempt = 1; attempt <= this.MAX_RETRIES; attempt++) {
      try {
        return await this.executeTransaction(dto);
      } catch (error) {
        if (
          error instanceof OptimisticLockVersionMismatchError &&
          attempt < this.MAX_RETRIES
        ) {
          this.logger.warn(
            `Optimistic lock conflict on attempt ${attempt}, retrying...`,
          );
          // Add exponential backoff
          await this.sleep(Math.pow(2, attempt) * 100);
          continue;
        }
        throw error;
      }
    }

    throw new Error('Transaction failed after maximum retries');
  }

  /**
   * Execute transaction within database transaction
   * This ensures atomicity and consistency
   */
  private async executeTransaction(
    dto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    return await this.dataSource.transaction(async (entityManager) => {
      // 1. Load wallet with optimistic lock
      const wallet = await entityManager.findOne(Wallet, {
        where: { id: dto.walletId },
      });

      if (!wallet) {
        throw new WalletNotFoundException(dto.walletId);
      }

      // 2. Convert currency to EGP
      const convertedAmount = this.currencyService.toEGP(
        dto.amount,
        dto.currency || 'EGP',
      );

      // 3. Calculate transaction impact (positive for deposit, negative for withdrawal)
      const transactionImpact =
        dto.type === TransactionType.DEPOSIT
          ? convertedAmount
          : -convertedAmount;

      // 4. Calculate new balance
      const newBalance = wallet.balance + transactionImpact;

      // 5. Validate balance never goes negative (ACID Consistency)
      if (newBalance < 0) {
        this.logger.warn(
          `Insufficient funds: wallet ${wallet.id}, balance ${wallet.balance}, requested ${Math.abs(transactionImpact)}`,
        );
        throw new InsufficientFundsException(
          wallet.balance,
          Math.abs(transactionImpact),
        );
      }

      // 6. Create transaction record (append-only ledger)
      const transaction = entityManager.create(Transaction, {
        transactionId: dto.transactionId,
        walletId: dto.walletId,
        type: dto.type,
        amount: dto.amount,
        currency: dto.currency || 'EGP',
        convertedAmount: transactionImpact,
        metadata: dto.metadata,
      });

      await entityManager.save(Transaction, transaction);

      // 7. Update wallet balance (optimistic locking will verify version)
      wallet.balance = newBalance;
      await entityManager.save(Wallet, wallet);

      this.logger.log(
        `Transaction ${dto.transactionId} completed: ${dto.type} ${dto.amount} ${dto.currency} (${convertedAmount} EGP), new balance: ${newBalance} EGP`,
      );

      return this.mapToResponseDto(transaction);
    });
  }

  /**
   * Get current wallet balance
   */
  async getBalance(walletId: string): Promise<BalanceResponseDto> {
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new WalletNotFoundException(walletId);
    }

    return {
      walletId: wallet.id,
      balance: wallet.balance,
      currency: wallet.currency,
      lastUpdatedAt: wallet.updatedAt,
    };
  }

  /**
   * Create a new wallet (utility method for testing)
   */
  async createWallet(
    initialBalance: number = 0,
    currency: string = 'EGP',
  ): Promise<Wallet> {
    const wallet = this.walletRepository.create({
      balance: initialBalance,
      currency,
    });

    return await this.walletRepository.save(wallet);
  }

  /**
   * Get transaction history for a wallet
   */
  async getTransactionHistory(
    walletId: string,
  ): Promise<TransactionResponseDto[]> {
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new WalletNotFoundException(walletId);
    }

    const transactions = await this.transactionRepository.find({
      where: { walletId },
      order: { createdAt: 'DESC' },
    });

    return transactions.map(this.mapToResponseDto);
  }

  /**
   * Validate balance consistency (for testing/reconciliation)
   * Compares wallet balance with sum of all transactions
   */
  async validateBalanceConsistency(walletId: string): Promise<boolean> {
    const wallet = await this.walletRepository.findOne({
      where: { id: walletId },
    });

    if (!wallet) {
      throw new WalletNotFoundException(walletId);
    }

    const result = await this.transactionRepository
      .createQueryBuilder('transaction')
      .select('SUM(transaction.convertedAmount)', 'sum')
      .where('transaction.walletId = :walletId', { walletId })
      .getRawOne();

    const calculatedBalance = parseFloat(result.sum || '0');
    const isConsistent = Math.abs(wallet.balance - calculatedBalance) < 0.01; // Allow for rounding

    if (!isConsistent) {
      this.logger.error(
        `Balance inconsistency detected for wallet ${walletId}: stored=${wallet.balance}, calculated=${calculatedBalance}`,
      );
    }

    return isConsistent;
  }

  private mapToResponseDto(transaction: Transaction): TransactionResponseDto {
    return {
      id: transaction.id,
      transactionId: transaction.transactionId,
      walletId: transaction.walletId,
      type: transaction.type,
      amount: transaction.amount,
      currency: transaction.currency,
      convertedAmount: transaction.convertedAmount,
      metadata: transaction.metadata,
      createdAt: transaction.createdAt,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
