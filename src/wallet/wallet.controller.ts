import {
  Controller,
  Post,
  Get,
  Body,
  Param,
  ValidationPipe,
  UsePipes,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { WalletService } from './wallet.service';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { TransactionResponseDto } from './dto/transaction-response.dto';
import { BalanceResponseDto } from './dto/balance-response.dto';

@Controller('wallet')
export class WalletController {
  constructor(private readonly walletService: WalletService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  async createWallet(
    @Body() body?: { initialBalance?: number; currency?: string },
  ) {
    return await this.walletService.createWallet(
      body?.initialBalance || 0,
      body?.currency || 'EGP',
    );
  }

  @Post('transaction')
  @HttpCode(HttpStatus.CREATED)
  @UsePipes(new ValidationPipe({ transform: true, whitelist: true }))
  async createTransaction(
    @Body() createTransactionDto: CreateTransactionDto,
  ): Promise<TransactionResponseDto> {
    return await this.walletService.createTransaction(createTransactionDto);
  }

  @Get(':walletId/balance')
  async getBalance(
    @Param('walletId') walletId: string,
  ): Promise<BalanceResponseDto> {
    return await this.walletService.getBalance(walletId);
  }

  @Get(':walletId/transactions')
  async getTransactionHistory(
    @Param('walletId') walletId: string,
  ): Promise<TransactionResponseDto[]> {
    return await this.walletService.getTransactionHistory(walletId);
  }
}
