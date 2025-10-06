import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { TypeOrmModule } from '@nestjs/typeorm';
import { WalletModule } from '../src/wallet/wallet.module';
import { CurrencyModule } from '../src/currency/currency.module';
import { Wallet } from '../src/wallet/entities/wallet.entity';
import { Transaction } from '../src/wallet/entities/transaction.entity';
import { WalletService } from '../src/wallet/wallet.service';
import { TransactionType } from '../src/wallet/enums/transaction-type.enum';

describe('Wallet API (e2e)', () => {
  let app: INestApplication;
  let walletService: WalletService;
  let testWallet: Wallet;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
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
          dropSchema: true,
        }),
        WalletModule,
        CurrencyModule,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();

    app.useGlobalPipes(
      new ValidationPipe({
        transform: true,
        whitelist: true,
        forbidNonWhitelisted: true,
      }),
    );

    await app.init();

    walletService = moduleFixture.get<WalletService>(WalletService);
  });

  beforeEach(async () => {
    testWallet = await walletService.createWallet(1000, 'EGP');
  });

  afterAll(async () => {
    await app.close();
  });

  describe('POST /wallet/transaction', () => {
    it('should create a deposit transaction', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          transactionId: 'e2e-deposit-1',
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          amount: 500,
          currency: 'EGP',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.type).toBe(TransactionType.DEPOSIT);
          expect(res.body.amount).toBe(500);
        });
    });

    it('should create a withdrawal transaction', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          transactionId: 'e2e-withdrawal-1',
          walletId: testWallet.id,
          type: TransactionType.WITHDRAWAL,
          amount: 200,
          currency: 'EGP',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body).toHaveProperty('id');
          expect(res.body.type).toBe(TransactionType.WITHDRAWAL);
          expect(res.body.amount).toBe(200);
        });
    });

    it('should reject withdrawal with insufficient funds', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          transactionId: 'e2e-overdraw-1',
          walletId: testWallet.id,
          type: TransactionType.WITHDRAWAL,
          amount: 5000,
          currency: 'EGP',
        })
        .expect(400)
        .expect((res) => {
          expect(res.body.error).toBe('INSUFFICIENT_FUNDS');
        });
    });

    it('should handle idempotent requests', async () => {
      const payload = {
        transactionId: 'e2e-idempotent-1',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 300,
        currency: 'EGP',
      };

      const firstResponse = await request(app.getHttpServer())
        .post('/wallet/transaction')
        .send(payload)
        .expect(201);

      const secondResponse = await request(app.getHttpServer())
        .post('/wallet/transaction')
        .send(payload)
        .expect(201);

      expect(firstResponse.body.id).toBe(secondResponse.body.id);
    });

    it('should validate required fields', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          // missing transactionId and amount
        })
        .expect(400);
    });

    it('should validate amount is positive', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          transactionId: 'e2e-invalid-amount',
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          amount: -100,
          currency: 'EGP',
        })
        .expect(400);
    });

    it('should handle currency conversion', () => {
      return request(app.getHttpServer())
        .post('/wallet/transaction')
        .send({
          transactionId: 'e2e-usd-deposit',
          walletId: testWallet.id,
          type: TransactionType.DEPOSIT,
          amount: 10,
          currency: 'USD',
        })
        .expect(201)
        .expect((res) => {
          expect(res.body.amount).toBe(10);
          expect(res.body.currency).toBe('USD');
          expect(res.body.convertedAmount).toBe(490); // 10 USD * 49
        });
    });
  });

  describe('GET /wallet/:walletId/balance', () => {
    it('should get wallet balance', async () => {
      return request(app.getHttpServer())
        .get(`/wallet/${testWallet.id}/balance`)
        .expect(200)
        .expect((res) => {
          expect(res.body.walletId).toBe(testWallet.id);
          expect(res.body.balance).toBe(1000);
          expect(res.body.currency).toBe('EGP');
          expect(res.body).toHaveProperty('lastUpdatedAt');
        });
    });

    it('should return 404 for non-existent wallet', () => {
      return request(app.getHttpServer())
        .get('/wallet/non-existent-id/balance')
        .expect(404)
        .expect((res) => {
          expect(res.body.error).toBe('WALLET_NOT_FOUND');
        });
    });

    it('should reflect updated balance after transaction', async () => {
      await request(app.getHttpServer()).post('/wallet/transaction').send({
        transactionId: 'e2e-balance-update',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 750,
        currency: 'EGP',
      });

      return request(app.getHttpServer())
        .get(`/wallet/${testWallet.id}/balance`)
        .expect(200)
        .expect((res) => {
          expect(res.body.balance).toBe(1750);
        });
    });
  });

  describe('GET /wallet/:walletId/transactions', () => {
    it('should get transaction history', async () => {
      await request(app.getHttpServer()).post('/wallet/transaction').send({
        transactionId: 'e2e-history-1',
        walletId: testWallet.id,
        type: TransactionType.DEPOSIT,
        amount: 100,
        currency: 'EGP',
      });

      await request(app.getHttpServer()).post('/wallet/transaction').send({
        transactionId: 'e2e-history-2',
        walletId: testWallet.id,
        type: TransactionType.WITHDRAWAL,
        amount: 50,
        currency: 'EGP',
      });

      return request(app.getHttpServer())
        .get(`/wallet/${testWallet.id}/transactions`)
        .expect(200)
        .expect((res) => {
          expect(Array.isArray(res.body)).toBe(true);
          expect(res.body.length).toBe(2);
        });
    });
  });

  describe('Concurrent Requests', () => {
    it('should handle multiple concurrent requests correctly', async () => {
      const requests = Array.from({ length: 10 }, (_, i) =>
        request(app.getHttpServer())
          .post('/wallet/transaction')
          .send({
            transactionId: `e2e-concurrent-${i}`,
            walletId: testWallet.id,
            type: TransactionType.DEPOSIT,
            amount: 10,
            currency: 'EGP',
          }),
      );

      await Promise.all(requests);

      const balanceResponse = await request(app.getHttpServer())
        .get(`/wallet/${testWallet.id}/balance`)
        .expect(200);

      expect(balanceResponse.body.balance).toBe(1100); // 1000 + (10 * 10)
    }, 30000);
  });
});
