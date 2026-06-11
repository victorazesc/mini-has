import { Injectable } from '@nestjs/common';
import { ProvidersService } from '../../infrastructure/providers/providers.service';

@Injectable()
export class IntegrationProviderService {
  constructor(private readonly providers: ProvidersService) { }

  listProviderDefinitions() {
    return this.providers.listProviderDefinitions();
  }
}