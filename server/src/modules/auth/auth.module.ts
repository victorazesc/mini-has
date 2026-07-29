import { Module } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { AuthController } from './auth.controller';
import { OAuthBearerGuard } from './auth.guard';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController],
  providers: [AuthService, OAuthBearerGuard, StorageService],
  exports: [AuthService, OAuthBearerGuard],
})
export class AuthModule {}
