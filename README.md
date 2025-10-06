# Wallet / Ledger Service

A production-ready wallet/ledger service built with NestJS that implements ACID principles for financial transactions.

## Features

- ✅ **ACID Compliance**: Full atomicity, consistency, isolation, and durability guarantees
- ✅ **Optimistic Locking**: Handles concurrent transactions with version control
- ✅ **Idempotency**: Duplicate transaction IDs are processed only once
- ✅ **Currency Conversion**: Multi-currency support with conversion to EGP
- ✅ **Balance Protection**: Prevents negative balances
- ✅ **Append-Only Ledger**: Immutable transaction history
- ✅ **Comprehensive Testing**: Unit, integration, and E2E tests with concurrency testing

## Architecture

### ACID Implementation

1. **Atomicity**: Database transactions ensure all-or-nothing execution
2. **Consistency**: Balance validation prevents negative balances
3. **Isolation**: Optimistic locking with version column prevents race conditions
4. **Durability**: PostgreSQL with WAL ensures persistence

### Concurrency Strategy

Uses **optimistic locking** with automatic retry mechanism:
- Each wallet has a `version` column
- Concurrent updates increment version
- Version mismatch triggers retry with exponential backoff
- Better performance than pessimistic locking for high concurrency

### Database Schema

**Wallets Table**
- `id` (UUID) - Primary key
- `balance` (DECIMAL) - Current balance in EGP
- `currency` (VARCHAR) - Base currency (default: EGP)
- `version` (INTEGER) - For optimistic locking
- `createdAt`, `updatedAt` - Timestamps

**Transactions Table**
- `id` (UUID) - Primary key
- `transactionId` (VARCHAR, UNIQUE) - For idempotency
- `walletId` (UUID) - Foreign key to wallets
- `type` (ENUM) - DEPOSIT or WITHDRAWAL
- `amount` (DECIMAL) - Original amount
- `currency` (VARCHAR) - Original currency
- `convertedAmount` (DECIMAL) - Amount in EGP
- `metadata` (JSONB) - Additional data
- `createdAt` - Timestamp

## API Endpoints

### POST /wallet/transaction

Create a new transaction (deposit or withdrawal).

**Request Body:**
```json
{
  "transactionId": "unique-tx-123",
  "walletId": "wallet-uuid",
  "type": "DEPOSIT",
  "amount": 100,
  "currency": "USD",
  "metadata": {
    "source": "bank_transfer"
  }
}
```

**Response:**
```json
{
  "id": "tx-uuid",
  "transactionId": "unique-tx-123",
  "walletId": "wallet-uuid",
  "type": "DEPOSIT",
  "amount": 100,
  "currency": "USD",
  "convertedAmount": 4900,
  "metadata": {
    "source": "bank_transfer"
  },
  "createdAt": "2025-10-04T10:30:00Z"
}
```

### GET /wallet/:walletId/balance

Retrieve current wallet balance.

**Response:**
```json
{
  "walletId": "wallet-uuid",
  "balance": 5000.00,
  "currency": "EGP",
  "lastUpdatedAt": "2025-10-04T10:30:00Z"
}
```

### GET /wallet/:walletId/transactions

Get transaction history for a wallet.

**Response:**
```json
[
  {
    "id": "tx-uuid",
    "transactionId": "unique-tx-123",
    "type": "DEPOSIT",
    "amount": 100,
    "currency": "USD",
    "convertedAmount": 4900,
    "createdAt": "2025-10-04T10:30:00Z"
  }
]
```

## Setup & Installation

### Prerequisites

- Node.js 18+
- PostgreSQL 15+
- Docker (optional, for running PostgreSQL)

### Installation

1. Clone the repository:
```bash
cd wallet-service
npm install
```

2. Set up environment variables:
```bash
cp .env.example .env
# Edit .env with your database credentials
```

3. Start PostgreSQL (using Docker):
```bash
docker-compose up -d postgres
```

4. Run the application:
```bash
npm run start:dev
```

The service will be available at `http://localhost:3000`

## API Testing

### Postman Collection

A complete Postman collection is included in this repository (`postman-collection.json`) with:
- Pre-configured requests for all endpoints
- Example payloads for deposits and withdrawals
- Saved wallet IDs for easy testing
- Error scenario examples

Import the collection into Postman to get started quickly with API testing.

## Testing

### Unit Tests
```bash
npm run test
```

### Integration Tests (requires PostgreSQL)
```bash
docker-compose up -d postgres-test
npm run test -- wallet.integration.spec
```

### E2E Tests
```bash
docker-compose up -d postgres-test
npm run test:e2e
```

### Test Coverage
```bash
npm run test:cov
```

## Testing Strategy

### Unit Tests (`wallet.service.spec.ts`)
- ✅ Deposit increases balance
- ✅ Withdrawal decreases balance
- ✅ Withdrawal fails if balance would go negative
- ✅ Idempotent transactions
- ✅ Currency conversion
- ✅ Wallet not found errors

### Integration Tests (`wallet.integration.spec.ts`)
- ✅ 20 concurrent deposits maintain consistency
- ✅ 30 concurrent mixed operations (deposits + withdrawals)
- ✅ Concurrent withdrawals prevent overdraft
- ✅ Duplicate transaction IDs processed once
- ✅ Concurrent duplicate requests
- ✅ Currency conversion accuracy
- ✅ Balance consistency validation

### E2E Tests (`wallet.e2e-spec.ts`)
- ✅ API endpoint validation
- ✅ Request/response format
- ✅ Error handling
- ✅ Concurrent HTTP requests

## Supported Currencies

- EGP (Egyptian Pound) - Base currency
- USD (US Dollar) - 1 USD = 49 EGP
- EUR (Euro) - 1 EUR = 53 EGP
- GBP (British Pound) - 1 GBP = 62 EGP
- SAR (Saudi Riyal) - 1 SAR = 13 EGP
- AED (UAE Dirham) - 1 AED = 13.3 EGP

*Note: Exchange rates are mocked for this implementation*

## Error Handling

### Insufficient Funds (400)
```json
{
  "statusCode": 400,
  "message": "Insufficient funds",
  "error": "INSUFFICIENT_FUNDS",
  "details": {
    "currentBalance": 100,
    "requestedAmount": 500,
    "shortfall": 400
  }
}
```

### Wallet Not Found (404)
```json
{
  "statusCode": 404,
  "message": "Wallet with ID xxx not found",
  "error": "WALLET_NOT_FOUND"
}
```

## Production Considerations

1. **Database Indexes**: Ensure indexes on `transactionId`, `walletId`, and `createdAt`
2. **Connection Pooling**: Configure TypeORM connection pool size
3. **Monitoring**: Add APM for tracking transaction performance
4. **Logging**: Enhanced structured logging for audit trails
5. **Rate Limiting**: Implement rate limiting per wallet
6. **Background Jobs**: Add reconciliation job to validate balance consistency
7. **Caching**: Consider Redis for frequently accessed balances

## License

MIT
