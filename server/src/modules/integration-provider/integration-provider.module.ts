import { Module } from '@nestjs/common';
import { IntegrationProviderController } from './integration-provider.controller';
import { IntegrationProviderService } from './integration-provider.service';

@Module({
  controllers: [IntegrationProviderController],
  providers: [IntegrationProviderService],
})
export class IntegrationProviderModule {}