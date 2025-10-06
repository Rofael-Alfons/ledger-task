import { Test, TestingModule } from '@nestjs/testing';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletService } from '../src/wallet/wallet.service';
import { WalletModule } from '../src/wallet/wallet.module';
import { CurrencyModule } from '../src/currency/currency.module';
import { Wallet } from '../src/wallet/entities/wallet.entity';
import { Transaction } from '../src/wallet/entities/transaction.entity';
import { TransactionType } from '../src/wallet/enums/transaction-type.enum';
import { DataSource } from 'typeorm';

describe('WalletService Integration Tests', () => {
  let service: WalletService;
  let dataSource: DataSource;
  let testWallet: Wallet;

  beforeAll(async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [
        TypeOrmModule.forRoot({
          type: 'postgres',
          host: process.env.DB_HOST || 'localhost',
          port: parseInt(process.env.DB_PORT, 10) || 5432,
          username: process.env.DB_USERNAME || 'postgres',
          password: process.env.DB_PASSWORD || 'postgres',
          database: process.env.DB_TEST_DATABASE || 'wallet_test_db',
          entities: [Wallet, Transaction],
          synchronize: true,
          dropSchema: true, // Clean slate for tests
        }),
        WalletModule,
        CurrencyModule,
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    dataSource = module.get<DataSource>(DataSource);
  });

  beforeEach(async () => {
    // Create a fresh wallet for each test
    testWallet = await service.createWallet(1000, 'EGP');
  });

  afterAll(async () => {
    await dataSource.destroy();
  });

  describe('Concurrent Transactions', () => {
    it('should handle 20 concurrent deposits correctly', async () => {
      const depositAmount = 50;
      const concurrentCount = 20;

      const promises = Array.from({ length: concurrentCount }, (_, i) =>
        service.createTransaction({
          transactionId: `concurrent-deposit-${i}`,
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          amount: depositAmount,
          currency: 'EGP',
        }),
      );

      await Promise.all(promises);

      const balance = await service.getBalance(testWallet.id);
      const expectedBalance = 1000 + depositAmount * concurrentCount;

      expect(balance.balance).toBe(expectedBalance);
    }, 30000);

    it('should handle concurrent deposits and withdrawals correctly', async () => {
      const operations = 30;
      const amount = 10;

      const promises = Array.from({ length: operations }, (_, i) =>
        service.createTransaction({
          transactionId: `concurrent-mixed-${i}`,
          walletId: testWallet.id,
          type:
            i % 2 === 0 ? TransactionType.DEPOSIT : TransactionType.WITHDRAWAL,
          amount: amount,
          currency: 'EGP',
        }),
      );

      await Promise.all(promises);

      const balance = await service.getBalance(testWallet.id);

      // 15 deposits (+150) and 15 withdrawals (-150) = no change
      expect(balance.balance).toBe(1000);

      // Verify balance consistency
      const isConsistent = await service.validateBalanceConsistency(
        testWallet.id,
      );
      expect(isConsistent).toBe(true);
    }, 30000);

    it('should prevent concurrent withdrawals from overdrawing', async () => {
      // Create a wallet with 100 EGP
      const smallWallet = await service.createWallet(100, 'EGP');

      // Attempt 10 concurrent withdrawals of 15 EGP each
      // Only 6 should succeed (6 * 15 = 90), others should fail
      const withdrawalAmount = 15;
      const attemptCount = 10;

      const promises = Array.from({ length: attemptCount }, (_, i) =>
        service
          .createTransaction({
            transactionId: `concurrent-withdrawal-${i}`,
            walletId: smallWallet.id,
            type: TransactionType.WITHDRAWAL,
            amount: withdrawalAmount,
            currency: 'EGP',
          })
          .catch((error) => error),
      );

      const results = await Promise.all(promises);

      const successCount = results.filter((r) => r && !r.message).length;
      const failCount = results.filter((r) => r && r.message).length;

      expect(successCount).toBeGreaterThan(0);
      expect(failCount).toBeGreaterThan(0);

      const finalBalance = await service.getBalance(smallWallet.id);
      expect(finalBalance.balance).toBeGreaterThanOrEqual(0);
      expect(finalBalance.balance).toBeLessThan(100);
    }, 30000);
  });

  describe('Idempotency Tests', () => {
    it('should process duplicate transactionId only once', async () => {
      const transactionId = 'idempotent-test-1';

      const firstResult = await service.createTransaction({
        transactionId,
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 100,
        currency: 'EGP',
      });

      const secondResult = await service.createTransaction({
        transactionId,
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 100,
        currency: 'EGP',
      });

      expect(firstResult.id).toBe(secondResult.id);

      const balance = await service.getBalance(testWallet.id);
      expect(balance.balance).toBe(1100); // Only one deposit
    });

    it('should handle concurrent duplicate requests correctly', async () => {
      const transactionId = 'concurrent-idempotent-test';

      const promises = Array.from({ length: 10 }, () =>
        service.createTransaction({
          transactionId,
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          amount: 200,
          currency: 'EGP',
        }),
      );

      const results = await Promise.all(promises);

      // All should return the same transaction
      const uniqueIds = new Set(results.map((r) => r.id));
      expect(uniqueIds.size).toBe(1);

      const balance = await service.getBalance(testWallet.id);
      expect(balance.balance).toBe(1200); // Only one deposit
    }, 30000);
  });

  describe('Currency Conversion Tests', () => {
    it('should correctly convert USD to EGP', async () => {
      const result = await service.createTransaction({
        transactionId: 'usd-conversion-test',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 10,
        currency: 'USD',
      });

      expect(result.convertedAmount).toBe(490); // 10 USD * 49 = 490 EGP

      const balance = await service.getBalance(testWallet.id);
      expect(balance.balance).toBe(1490);
    });

    it('should correctly convert EUR to EGP', async () => {
      const result = await service.createTransaction({
        transactionId: 'eur-conversion-test',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 5,
        currency: 'EUR',
      });

      expect(result.convertedAmount).toBe(265); // 5 EUR * 53 = 265 EGP

      const balance = await service.getBalance(testWallet.id);
      expect(balance.balance).toBe(1265);
    });
  });

  describe('Balance Consistency', () => {
    it('should maintain balance consistency after multiple transactions', async () => {
      await service.createTransaction({
        transactionId: 'consistency-1',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 500,
        currency: 'EGP',
      });

      await service.createTransaction({
        transactionId: 'consistency-2',
        walletId: testWallet.id,
        type: TransactionType.WITHDRAWAL,
        amount: 200,
        currency: 'EGP',
      });

      await service.createTransaction({
        transactionId: 'consistency-3',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 100,
        currency: 'EGP',
      });

      const isConsistent = await service.validateBalanceConsistency(
        testWallet.id,
      );
      expect(isConsistent).toBe(true);

      const balance = await service.getBalance(testWallet.id);
      expect(balance.balance).toBe(1400); // 1000 + 500 - 200 + 100
    });
  });
});
