import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { WalletService } from './wallet.service';
import { Wallet } from './entities/wallet.entity';
import { Transaction } from './entities/transaction.entity';
import { CurrencyService } from '../currency/currency.service';
import { TransactionType } from './enums/transaction-type.enum';
import { InsufficientFundsException } from './exceptions/insufficient-funds.exception';
import { WalletNotFoundException } from './exceptions/wallet-not-found.exception';

describe('WalletService', () => {
  let service: WalletService;
  let walletRepository: Repository<Wallet>;
  let transactionRepository: Repository<Transaction>;
  let currencyService: CurrencyService;
  let dataSource: DataSource;

  const mockWallet: Wallet = {
    id: 'wallet-123',
    balance: 1000,
    currency: 'EGP',
    version: 1,
    createdAt: new Date(),
    updatedAt: new Date(),
    transactions: [],
  };

  const mockTransaction: Transaction = {
    id: 'tx-123',
    transactionId: 'unique-tx-123',
    walletId: 'wallet-123',
    type: TransactionType.DEPOSIT,
    amount: 100,
    currency: 'EGP',
    convertedAmount: 100,
    metadata: null,
    createdAt: new Date(),
    wallet: mockWallet,
  };

  beforeEach(async () => {
    const mockEntityManager = {
      findOne: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WalletService,
        {
          provide: getRepositoryToken(Wallet),
          useValue: {
            findOne: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
          },
        },
        {
          provide: getRepositoryToken(Transaction),
          useValue: {
            findOne: jest.fn(),
            find: jest.fn(),
            create: jest.fn(),
            save: jest.fn(),
            createQueryBuilder: jest.fn(),
          },
        },
        {
          provide: CurrencyService,
          useValue: {
            toEGP: jest.fn((amount) => amount),
          },
        },
        {
          provide: DataSource,
          useValue: {
            transaction: jest.fn((callback) => callback(mockEntityManager)),
          },
        },
      ],
    }).compile();

    service = module.get<WalletService>(WalletService);
    walletRepository = module.get<Repository<Wallet>>(
      getRepositoryToken(Wallet),
    );
    transactionRepository = module.get<Repository<Transaction>>(
      getRepositoryToken(Transaction),
    );
    currencyService = module.get<CurrencyService>(CurrencyService);
    dataSource = module.get<DataSource>(DataSource);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createTransaction - Deposit', () => {
    it('should successfully create a deposit and increase balance', async () => {
      const createDto = {
        transactionId: 'unique-tx-deposit',
        walletId: 'wallet-123',
        type: TransactionType.DEPOSIT,
        amount: 500,
        currency: 'EGP',
      };

      jest.spyOn(transactionRepository, 'findOne').mockResolvedValue(null);

      const mockEntityManager = {
        findOne: jest.fn().mockResolvedValue({ ...mockWallet }),
        create: jest.fn().mockReturnValue(mockTransaction),
        save: jest.fn().mockImplementation((entity, data) => {
          if (entity === Transaction) {
            return Promise.resolve(data);
          }
          return Promise.resolve({ ...mockWallet, balance: 1500 });
        }),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((callback: any) => callback(mockEntityManager));

      const result = await service.createTransaction(createDto);

      expect(result).toBeDefined();
      expect(result.type).toBe(TransactionType.DEPOSIT);
    });
  });

  describe('createTransaction - Withdrawal', () => {
    it('should successfully create a withdrawal and decrease balance', async () => {
      const createDto = {
        transactionId: 'unique-tx-withdrawal',
        walletId: 'wallet-123',
        type: TransactionType.WITHDRAWAL,
        amount: 200,
        currency: 'EGP',
      };

      jest.spyOn(transactionRepository, 'findOne').mockResolvedValue(null);

      const mockEntityManager = {
        findOne: jest.fn().mockResolvedValue({ ...mockWallet, balance: 1000 }),
        create: jest.fn().mockReturnValue({
          ...mockTransaction,
          type: TransactionType.WITHDRAWAL,
        }),
        save: jest.fn().mockImplementation((entity, data) => {
          if (entity === Transaction) {
            return Promise.resolve(data);
          }
          return Promise.resolve({ ...mockWallet, balance: 800 });
        }),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((callback: any) => callback(mockEntityManager));

      const result = await service.createTransaction(createDto);

      expect(result).toBeDefined();
      expect(result.type).toBe(TransactionType.WITHDRAWAL);
    });

    it('should fail when withdrawal would result in negative balance', async () => {
      const createDto = {
        transactionId: 'unique-tx-overdraw',
        walletId: 'wallet-123',
        type: TransactionType.WITHDRAWAL,
        amount: 2000,
        currency: 'EGP',
      };

      jest.spyOn(transactionRepository, 'findOne').mockResolvedValue(null);

      const mockEntityManager = {
        findOne: jest.fn().mockResolvedValue({ ...mockWallet, balance: 1000 }),
        create: jest.fn(),
        save: jest.fn(),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((callback: any) => callback(mockEntityManager));

      await expect(service.createTransaction(createDto)).rejects.toThrow(
        InsufficientFundsException,
      );
    });
  });

  describe('Idempotency', () => {
    it('should return existing transaction if same transactionId is used', async () => {
      const createDto = {
        transactionId: 'duplicate-tx',
        walletId: 'wallet-123',
        type: TransactionType.DEPOSIT,
        amount: 100,
        currency: 'EGP',
      };

      jest
        .spyOn(transactionRepository, 'findOne')
        .mockResolvedValue(mockTransaction);

      const result = await service.createTransaction(createDto);

      expect(result).toBeDefined();
      expect(result.id).toBe(mockTransaction.id);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });

  describe('getBalance', () => {
    it('should return wallet balance', async () => {
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(mockWallet);

      const result = await service.getBalance('wallet-123');

      expect(result).toBeDefined();
      expect(result.balance).toBe(1000);
      expect(result.currency).toBe('EGP');
      expect(result.walletId).toBe('wallet-123');
    });

    it('should throw WalletNotFoundException for non-existent wallet', async () => {
      jest.spyOn(walletRepository, 'findOne').mockResolvedValue(null);

      await expect(service.getBalance('non-existent')).rejects.toThrow(
        WalletNotFoundException,
      );
    });
  });

  describe('Currency Conversion', () => {
    it('should convert USD to EGP before processing', async () => {
      const createDto = {
        transactionId: 'unique-tx-usd',
        walletId: 'wallet-123',
        type: TransactionType.DEPOSIT,
        amount: 10,
        currency: 'USD',
      };

      jest.spyOn(transactionRepository, 'findOne').mockResolvedValue(null);
      jest.spyOn(currencyService, 'toEGP').mockReturnValue(490); // 10 USD = 490 EGP

      const mockEntityManager = {
        findOne: jest.fn().mockResolvedValue({ ...mockWallet }),
        create: jest.fn().mockReturnValue(mockTransaction),
        save: jest.fn().mockResolvedValue(mockTransaction),
      };

      jest
        .spyOn(dataSource, 'transaction')
        .mockImplementation((callback: any) => callback(mockEntityManager));

      await service.createTransaction(createDto);

      expect(currencyService.toEGP).toHaveBeenCalledWith(10, 'USD');
    });
  });
});
