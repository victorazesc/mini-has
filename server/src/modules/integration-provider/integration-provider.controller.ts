import { Controller, Get } from '@nestjs/common';
import { IntegrationProviderService } from './integration-provider.service';

@Controller('integration-providers')
export class IntegrationProviderController {
  constructor(private readonly integrationProviderService: IntegrationProviderService) {}

  @Get()
  listProviderDefinitions() {
    return this.integrationProviderService.listProviderDefinitions();
  }
}