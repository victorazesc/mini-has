import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { IntegrationService } from './integration.service';

@Controller('integrations')
export class IntegrationController {
  constructor(
    private readonly integrationService: IntegrationService,
    private readonly commonService: CommonService,
  ) {}

  @Get()
  listIntegrations() {
    return this.integrationService.listIntegrations();
  }

  @Get(':integration_id')
  getIntegration(@Param('integration_id') integrationId: string) {
    const integration = this.integrationService.getIntegration(Number(integrationId));
    if (!integration) throw this.commonService.notFound('Integration not found');
    return this.integrationService.publicIntegration(integration);
  }

  @Patch(':integration_id')
  async updateIntegration(@Param('integration_id') integrationId: string, @Body() body: JsonObject) {
    const integration = await this.integrationService.updateIntegration(Number(integrationId), body);
    if (!integration) throw this.commonService.notFound('Integration not found');
    return integration;
  }

  @Post()
  async createIntegration(@Body() body: JsonObject) {
    return this.integrationService.createIntegration(body);
  }

  @Post(':integration_id/test')
  async testIntegration(@Param('integration_id') integrationId: string) {
    const result = await this.integrationService.testIntegration(Number(integrationId));
    if (!result) throw this.commonService.notFound('Integration not found');
    return result;
  }

  @Post(':integration_id/sync')
  async syncIntegration(@Param('integration_id') integrationId: string) {
    const result = await this.integrationService.syncIntegration(Number(integrationId));
    if (!result) throw this.commonService.notFound('Integration not found');
    return result;
  }

  @Delete(':integration_id')
  deleteIntegration(@Param('integration_id') integrationId: string) {
    if (!this.integrationService.deleteIntegration(Number(integrationId))) throw this.commonService.notFound('Integration not found');
    return { deleted: true };
  }
}