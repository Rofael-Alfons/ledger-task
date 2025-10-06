# Architecture & Design Decisions

## Overview

This wallet/ledger service implements a production-grade financial transaction system with ACID guarantees, designed for high concurrency and data integrity.

## Design Decisions

### 1. Optimistic Locking vs Pessimistic Locking

**Decision**: Optimistic Locking with Version Column

**Rationale**:
- Better performance under high concurrency
- No database locks held during business logic execution
- Retry mechanism handles version conflicts automatically
- Reduces database contention

**Trade-offs**:
- Requires retry logic (implemented with exponential backoff)
- May cause transaction failures under very high contention
- For this use case, optimistic locking is superior as most transactions succeed on first attempt

**Alternative Considered**: Pessimistic locking with `SELECT FOR UPDATE`
- Would guarantee no conflicts but increase lock contention
- Could cause deadlocks under high load

### 2. Single-Entry Ledger vs Double-Entry Bookkeeping

**Decision**: Single-Entry Ledger with Append-Only Transactions

**Rationale**:
- Simpler implementation for basic wallet operations
- Sufficient for single-entity balance tracking
- Transactions are immutable (append-only)
- Balance is maintained in wallet entity for fast reads

**Trade-offs**:
- Not suitable for complex accounting with multiple accounts
- For wallet use case, single-entry is sufficient and more performant

**Alternative Considered**: Double-Entry Bookkeeping
- Would allow tracking money flow between accounts
- More complex, unnecessary for single-wallet tracking

### 3. Balance Storage Strategy

**Decision**: Pre-calculated Balance in Wallet Entity

**Rationale**:
- Fast balance reads (single query)
- Balance updated atomically with transaction creation
- Consistency maintained via database transactions

**Implementation**:
```typescript
// Balance updated in same transaction as ledger entry
wallet.balance = wallet.balance + transactionImpact;
await entityManager.save(wallet);
```

**Validation**:
- `validateBalanceConsistency()` method compares stored balance vs sum of transactions
- Can be run as background job for reconciliation

### 4. Idempotency Implementation

**Decision**: Unique Constraint on `transactionId`

**Rationale**:
- Database-level guarantee of uniqueness
- Check before transaction prevents duplicates
- Handles concurrent duplicate requests safely

**Implementation**:
```typescript
// Check if transaction already exists
const existing = await this.transactionRepository.findOne({
  where: { transactionId: dto.transactionId }
});
if (existing) return existing; // Idempotent response
```

### 5. Currency Conversion Strategy

**Decision**: Convert to Base Currency (EGP) Before Storage

**Rationale**:
- All balances in single currency simplifies calculations
- Store both original and converted amounts for audit trail
- Conversion happens before balance validation

**Schema**:
```typescript
{
  amount: 100,           // Original amount
  currency: 'USD',       // Original currency
  convertedAmount: 4900  // Stored in EGP
}
```

### 6. Concurrency Control Flow

```
Request → Check Idempotency → Start DB Transaction
    ↓
Load Wallet (with version)
    ↓
Convert Currency
    ↓
Calculate New Balance
    ↓
Validate Balance ≥ 0
    ↓
Create Transaction Record
    ↓
Update Wallet Balance & Version
    ↓
Commit → Success
    ↓ (Version Conflict?)
Retry with Exponential Backoff
```

### 7. Transaction Impact Calculation

**Decision**: Store Signed Amounts Based on Type

```typescript
const transactionImpact =
  dto.type === DEPOSIT ? convertedAmount : -convertedAmount;

wallet.balance += transactionImpact;
```

**Rationale**:
- Clear separation of deposit vs withdrawal
- Prevents sign errors
- Easy to sum for balance reconciliation

### 8. Error Handling Strategy

**Custom Exceptions**:
- `InsufficientFundsException` - Balance would go negative
- `WalletNotFoundException` - Wallet doesn't exist

**Benefits**:
- Type-safe error handling
- Consistent error responses
- Rich error details for debugging

### 9. Testing Strategy

**Three-Layer Testing**:

1. **Unit Tests** (`wallet.service.spec.ts`)
   - Test business logic in isolation
   - Mock all dependencies
   - Fast execution

2. **Integration Tests** (`wallet.integration.spec.ts`)
   - Test with real database
   - Focus on concurrency scenarios
   - Validate ACID properties

3. **E2E Tests** (`wallet.e2e-spec.ts`)
   - Test HTTP API endpoints
   - Validate request/response formats
   - Test error responses

### 10. Database Schema Design

**Wallets Table**:
```sql
CREATE TABLE wallets (
  id UUID PRIMARY KEY,
  balance DECIMAL(20,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  version INTEGER NOT NULL,  -- Optimistic lock
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

**Transactions Table**:
```sql
CREATE TABLE transactions (
  id UUID PRIMARY KEY,
  transaction_id VARCHAR(255) UNIQUE NOT NULL,  -- Idempotency
  wallet_id UUID REFERENCES wallets(id),
  type VARCHAR(20) NOT NULL,
  amount DECIMAL(20,2) NOT NULL,
  currency VARCHAR(3) NOT NULL,
  converted_amount DECIMAL(20,2) NOT NULL,
  metadata JSONB,
  created_at TIMESTAMP NOT NULL
);

CREATE INDEX idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX idx_transactions_created_at ON transactions(created_at);
```

## ACID Compliance Implementation

### Atomicity
✅ All operations within `dataSource.transaction()` callback
✅ Either all succeed or all rollback

### Consistency
✅ Balance validation before commit
✅ Foreign key constraints
✅ Check constraints (balance >= 0 at application level)

### Isolation
✅ Optimistic locking prevents lost updates
✅ Read Committed isolation level (PostgreSQL default)
✅ Version column detects concurrent modifications

### Durability
✅ PostgreSQL Write-Ahead Logging (WAL)
✅ fsync enabled by default
✅ Transactions committed to disk

## Performance Considerations

### Optimizations
- Indexed columns: `transactionId`, `walletId`, `createdAt`
- Connection pooling (TypeORM default)
- Optimistic locking (no database locks)
- Pre-calculated balances (no aggregation on read)

### Scalability
- Horizontal scaling: Read replicas for balance queries
- Vertical scaling: Increase database resources
- Sharding: Partition by walletId for very large scale

### Monitoring Points
- Transaction retry rate (optimistic lock conflicts)
- Average transaction duration
- Balance reconciliation job results
- Database connection pool utilization

## Security Considerations

1. **Input Validation**: class-validator on all DTOs
2. **SQL Injection**: TypeORM parameterized queries
3. **Negative Balance**: Application-level validation
4. **Audit Trail**: Immutable transaction log

## Future Enhancements

1. **Webhooks**: Notify on transaction completion
2. **Soft Deletes**: Wallet archiving
3. **Transaction Limits**: Daily/monthly limits per wallet
4. **Fee Calculation**: Support transaction fees
5. **Batch Operations**: Bulk transaction creation
6. **Caching**: Redis for hot wallet balances
7. **Event Sourcing**: Store all state changes as events
