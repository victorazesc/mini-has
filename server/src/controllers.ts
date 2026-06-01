import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { CommandsService } from './commands';
import { DiscoveryService } from './discovery';
import { ProvidersService } from './providers';
import { HomeService } from './services';
import { CommandRequest, CreateDiscoveryJobRequest, InboxStatus, IntegrationStatus, IntegrationType, JsonObject, StoredIntegration } from './types';

@Controller()
export class AppController {
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
@Controller('rooms')
export class RoomsController {
  constructor(private readonly home: HomeService) { }

  @Get()
  listRooms() {
    return this.home.listRooms();
  }

  @Get(':room_id')
  getRoom(@Param('room_id') roomId: string) {
    const room = this.home.getRoom(Number(roomId));
    if (!room) throw notFound('Room not found');
    return room;
  }

  @Post()
  createRoom(@Body() body: JsonObject) {
    return this.home.createRoom(body);
  }

  @Patch(':room_id')
  updateRoom(@Param('room_id') roomId: string, @Body() body: JsonObject) {
    const room = this.home.updateRoom(Number(roomId), body);
    if (!room) throw notFound('Room not found');
    return room;
  }

  @Delete(':room_id')
  deleteRoom(@Param('room_id') roomId: string) {
    if (!this.home.deleteRoom(Number(roomId))) throw notFound('Room not found');
    return { deleted: true };
  }
}

@Controller('scenes')
export class ScenesController {
  constructor(
    private readonly home: HomeService,
    private readonly commands: CommandsService,
  ) { }

  @Get()
  listScenes() {
    return this.home.listScenes();
  }

  @Get(':scene_id')
  getScene(@Param('scene_id') sceneId: string) {
    const scene = this.home.getScene(Number(sceneId));
    if (!scene) throw notFound('Scene not found');
    return scene;
  }

  @Get(':scene_id/runs')
  listSceneRuns(@Param('scene_id') sceneId: string, @Query('limit') limit?: string) {
    const id = Number(sceneId);
    const scene = this.home.getScene(id);
    if (!scene) throw notFound('Scene not found');
    return this.home.listSceneRuns(id, Number(limit || 10));
  }

  @Post()
  createScene(@Body() body: JsonObject) {
    try {
      return this.home.createScene(body);
    } catch (error) {
      throw badRequest(messageFrom(error));
    }
  }

  @Patch(':scene_id')
  updateScene(@Param('scene_id') sceneId: string, @Body() body: JsonObject) {
    try {
      const scene = this.home.updateScene(Number(sceneId), body);
      if (!scene) throw notFound('Scene not found');
      return scene;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) throw error;
      throw badRequest(messageFrom(error));
    }
  }

  @Delete(':scene_id')
  deleteScene(@Param('scene_id') sceneId: string) {
    if (!this.home.deleteScene(Number(sceneId))) throw notFound('Scene not found');
    return { deleted: true };
  }

  @Post(':scene_id/run')
  async runScene(@Param('scene_id') sceneId: string) {
    const run = await this.home.runScene(
      Number(sceneId),
      (device, secrets, request) => this.commands.executeDeviceCommand(device, secrets, request),
    );
    if (!run) throw notFound('Scene not found');
    return run;
  }
}

@Controller('automations')
export class AutomationsController {
  constructor(private readonly home: HomeService) { }

  @Get()
  listAutomations() {
    return this.home.listAutomations();
  }

  @Get(':automation_id/runs')
  listAutomationRuns(@Param('automation_id') automationId: string, @Query('limit') limit?: string) {
    const id = Number(automationId);
    const automation = this.home.getAutomation(id);
    if (!automation) throw notFound('Automation not found');
    return this.home.listAutomationRuns(id, Number(limit || 10));
  }

  @Get(':automation_id')
  getAutomation(@Param('automation_id') automationId: string) {
    const automation = this.home.getAutomation(Number(automationId));
    if (!automation) throw notFound('Automation not found');
    return automation;
  }

  @Post()
  createAutomation(@Body() body: JsonObject) {
    try {
      return this.home.createAutomation(body);
    } catch (error) {
      throw badRequest(messageFrom(error));
    }
  }

  @Patch(':automation_id')
  updateAutomation(@Param('automation_id') automationId: string, @Body() body: JsonObject) {
    try {
      const automation = this.home.updateAutomation(Number(automationId), body);
      if (!automation) throw notFound('Automation not found');
      return automation;
    } catch (error) {
      if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) throw error;
      throw badRequest(messageFrom(error));
    }
  }

  @Delete(':automation_id')
  deleteAutomation(@Param('automation_id') automationId: string) {
    if (!this.home.deleteAutomation(Number(automationId))) throw notFound('Automation not found');
    return { deleted: true };
  }
}

@Controller('devices')
export class DevicesController {
  constructor(
    private readonly home: HomeService,
    private readonly commands: CommandsService,
  ) { }

  @Get()
  listDevices() {
    return this.home.listDevices();
  }

  @Post('auto-link-local')
  autoLinkLocalDevices() {
    return this.home.autoLinkLocalDevices();
  }

  @Post()
  createDevice(@Body() body: JsonObject) {
    return this.home.createDevice(body);
  }

  @Get(':device_id')
  getDevice(@Param('device_id') deviceId: string) {
    const device = this.home.getDevice(Number(deviceId));
    if (!device) throw notFound('Device not found');
    return device;
  }

  @Get(':device_id/history')
  getDeviceHistory(@Param('device_id') deviceId: string, @Query('limit') limit?: string) {
    const id = Number(deviceId);
    const device = this.home.getDevice(id);
    if (!device) throw notFound('Device not found');
    return this.home.listDeviceHistory(id, Number(limit || 40));
  }

  @Patch(':device_id')
  updateDevice(@Param('device_id') deviceId: string, @Body() body: JsonObject) {
    const device = this.home.updateDevice(Number(deviceId), body);
    if (!device) throw notFound('Device not found');
    return device;
  }

  @Post(':device_id/link-local')
  linkLocalDevice(@Param('device_id') deviceId: string, @Body() body: JsonObject) {
    const device = this.home.linkLocalDevice(Number(deviceId), body.localDeviceKey, body.payload || {});
    if (!device) throw notFound('Device not found');
    return device;
  }

  @Post(':device_id/auto-link-local')
  autoLinkLocalDevice(@Param('device_id') deviceId: string) {
    const device = this.home.autoLinkLocalDevice(Number(deviceId));
    if (!device) throw notFound('Device not found');
    return device;
  }

  @Post(':device_id/command')
  async commandDevice(@Param('device_id') deviceId: string, @Body() body: CommandRequest) {
    const item = this.home.getDeviceWithSecrets(Number(deviceId));
    if (!item) throw notFound('Device not found');
    const result = await this.commands.executeDeviceCommand(item.device, item.secrets, { command: body.command, params: body.params || {} });
    this.home.updateDeviceRuntimeState(Number(deviceId), result);
    this.home.logDeviceCommand(Number(deviceId), { command: body.command, params: body.params || {} }, result);
    return result;
  }

  @Delete(':device_id')
  deleteDevice(@Param('device_id') deviceId: string) {
    if (!this.home.deleteDevice(Number(deviceId))) throw notFound('Device not found');
    return { deleted: true };
  }
}

@Controller('entities')
export class EntitiesController {
  constructor(private readonly home: HomeService) { }

  @Get()
  listEntities() {
    return this.home.listEntities();
  }

  @Get(':entity_id')
  getEntity(@Param('entity_id') entityId: string) {
    const entity = this.home.getEntity(Number(entityId));
    if (!entity) throw notFound('Entity not found');
    return entity;
  }

  @Post(':entity_id/command')
  commandEntity(@Param('entity_id') entityId: string, @Body() body: CommandRequest) {
    const result = this.home.logEntityCommand(Number(entityId), { command: body.command, params: body.params || {} });
    if (!result) throw notFound('Entity not found');
    return result;
  }
}

@Controller('inbox')
export class InboxController {
  constructor(private readonly home: HomeService) { }

  @Get('devices')
  listInboxDevices(@Query('status') status?: InboxStatus, @Query('provider') provider?: string) {
    return this.home.listInboxDevices(status || undefined, provider || undefined);
  }

  @Post('devices/:inbox_id/accept')
  acceptInboxDevice(@Param('inbox_id') inboxId: string, @Body() body: JsonObject) {
    const item = this.home.getInboxPayloadWithSecrets(Number(inboxId));
    if (!item) throw notFound('Inbox device not found');
    const device = this.home.acceptInboxDevice(item.inbox, item.secrets, body.name, body.roomId);
    if (body.createEntities ?? true) {
      this.home.createEntitiesForDevice(device.id, device.provider, device.externalId, item.inbox.payload.entities || []);
    }
    this.home.markInboxStatus(Number(inboxId), 'accepted');
    this.home.markInboxDuplicatesStatus(device.provider, device.externalId, 'accepted');
    return device;
  }

  @Post('devices/:inbox_id/ignore')
  ignoreInboxDevice(@Param('inbox_id') inboxId: string) {
    const inbox = this.home.markInboxStatus(Number(inboxId), 'ignored');
    if (!inbox) throw notFound('Inbox device not found');
    return inbox;
  }
}

@Controller('integration-providers')
export class IntegrationProvidersController {
  constructor(private readonly providers: ProvidersService) { }

  @Get()
  listProviderDefinitions() {
    return this.providers.listProviderDefinitions();
  }
}

@Controller('integrations')
export class IntegrationsController {
  constructor(
    private readonly home: HomeService,
    private readonly providers: ProvidersService,
  ) { }

  @Get()
  listIntegrations() {
    return this.home.listIntegrations().map((integration) => this.home.publicIntegration(integration));
  }

  @Get(':integration_id')
  getIntegration(@Param('integration_id') integrationId: string) {
    const integration = this.home.getIntegration(Number(integrationId));
    if (!integration) throw notFound('Integration not found');
    return this.home.publicIntegration(integration);
  }

  @Patch(':integration_id')
  async updateIntegration(@Param('integration_id') integrationId: string, @Body() body: JsonObject) {
    const id = Number(integrationId);
    const integration = this.home.getIntegration(id);
    if (!integration) throw notFound('Integration not found');

    const name = String(body.name || integration.name).trim();
    if (!name) throw new HttpException({ detail: 'Nome e obrigatorio.' }, HttpStatus.BAD_REQUEST);

    const [configPatch, secretPatch] = this.providers.splitProviderConfig(integration.type, body.config || {});
    const config = { ...integration.config, ...withoutEmptyValues(configPatch) };
    const secrets = { ...integration.secrets, ...withoutEmptyValues(secretPatch) };

    let status: IntegrationStatus = 'created';
    if (body.testOnUpdate ?? body.test_on_update ?? true) {
      const now = new Date().toISOString();
      const pending: StoredIntegration = { ...integration, name, status: 'created', config, secrets, updatedAt: now };
      const result = await this.providers.testProvider(pending);
      if (!result.ok) throw new HttpException({ detail: result.message }, HttpStatus.BAD_REQUEST);
      status = result.status;
    }

    const updated = this.home.updateIntegration(id, name, config, secrets, status);
    if (!updated) throw notFound('Integration not found');
    return this.home.publicIntegration(updated);
  }

  @Post()
  async createIntegration(@Body() body: JsonObject) {
    const type = body.type as IntegrationType;
    const [config, secrets] = this.providers.splitProviderConfig(type, body.config || {});
    if (type === 'tuya_cloud') {
      const accessId = String(config.accessId || '').trim();
      if (accessId) config.accessId = accessId;
      if (this.home.findIntegrationByConfigValue(type, 'accessId', accessId)) {
        throw new HttpException({ detail: 'Ja existe uma integracao Tuya Cloud com este Access ID.' }, HttpStatus.CONFLICT);
      }
    }

    let status: IntegrationStatus = 'created';
    if (body.testOnCreate ?? body.test_on_create ?? true) {
      const now = new Date().toISOString();
      const pending: StoredIntegration = { id: 0, type, name: body.name, status: 'created', config, secrets, createdAt: now, updatedAt: now };
      const result = await this.providers.testProvider(pending);
      if (!result.ok) throw new HttpException({ detail: result.message }, HttpStatus.BAD_REQUEST);
      status = result.status;
    }

    if (type === 'smartthings_cloud') {
      const existing = this.home.findLatestIntegrationByType(type);
      if (existing) {
        const updated = this.home.updateIntegrationConfigAndSecrets(existing.id, { ...existing.config, ...config }, { ...existing.secrets, ...secrets }, status);
        if (updated) return this.home.publicIntegration(updated);
      }
    }

    return this.home.publicIntegration(this.home.createIntegration(body, config, secrets, status));
  }

  @Post(':integration_id/test')
  async testIntegration(@Param('integration_id') integrationId: string) {
    const integration = this.home.getIntegration(Number(integrationId));
    if (!integration) throw notFound('Integration not found');
    const result = await this.providers.testProvider(integration);
    this.home.updateIntegrationStatus(Number(integrationId), result.status, result.ok ? null : result.message);
    return { ...result, details: result.details || {} };
  }

  @Post(':integration_id/sync')
  async syncIntegration(@Param('integration_id') integrationId: string) {
    const id = Number(integrationId);
    const integration = this.home.getIntegration(id);
    if (!integration) throw notFound('Integration not found');
    this.home.updateIntegrationStatus(id, 'syncing');
    try {
      const [devices, details] = await this.providers.syncProvider(integration);
      const inboxIds: number[] = [];
      const inboxDevices = [];
      for (const device of devices) {
        const { secrets, ...payload } = device;
        const inboxId = this.home.upsertInboxItem('integration', id, device.externalId, payload, secrets || {}, device.ip ? 0.75 : 0.5);
        inboxIds.push(inboxId);
        const inboxDevice = this.home.getInboxDevice(inboxId);
        if (inboxDevice) inboxDevices.push(inboxDevice);
      }
      this.home.updateIntegrationStatus(id, 'connected', null, new Date().toISOString());
      return {
        ok: true,
        integrationId: id,
        imported: inboxIds.length,
        inboxIds,
        inboxDevices,
        message: 'Sync concluido.',
        details,
      };
    } catch (error) {
      const message = messageFrom(error);
      this.home.updateIntegrationStatus(id, 'error', message);
      return { ok: false, integrationId: id, imported: 0, inboxIds: [], message };
    }
  }

  @Delete(':integration_id')
  deleteIntegration(@Param('integration_id') integrationId: string) {
    if (!this.home.deleteIntegration(Number(integrationId))) throw notFound('Integration not found');
    return { deleted: true };
  }
}

@Controller('discovery')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) { }

  @Post('jobs')
  createJob(@Body() body: CreateDiscoveryJobRequest) {
    const job = this.discovery.createDiscoveryJob(body);
    void this.discovery.runDiscoveryJob(job.id, body);
    return { job_id: job.id, status: job.status };
  }

  @Get('jobs')
  listJobs() {
    return this.discovery.listJobs();
  }

  @Get('jobs/:job_id')
  getJob(@Param('job_id') jobId: string) {
    const job = this.discovery.getJob(jobId);
    if (!job) throw notFound('Discovery job not found');
    return job;
  }

  @Post('scan')
  async scanNow(@Body() body: CreateDiscoveryJobRequest, @Res({ passthrough: true }) response: any) {
    const { scanId, result } = await this.discovery.scanNow(body);
    response.setHeader('X-Discovery-Scan-Id', String(scanId));
    return result;
  }

  @Get('scans')
  listScans() {
    return this.discovery.listSavedScans();
  }

  @Get('scans/:scan_id')
  getScan(@Param('scan_id') scanId: string) {
    const scan = this.discovery.getSavedScan(Number(scanId));
    if (!scan) throw notFound('Discovery scan not found');
    return scan;
  }

  @Get('devices')
  listDevices() {
    return this.discovery.listSavedDevices();
  }
}

function notFound(detail: string): HttpException {
  return new HttpException({ detail }, HttpStatus.NOT_FOUND);
}

function badRequest(detail: string): HttpException {
  return new HttpException({ detail }, HttpStatus.BAD_REQUEST);
}

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function withoutEmptyValues(value: JsonObject): JsonObject {
  return Object.fromEntries(
    Object.entries(value || {}).filter(([, item]) => item !== undefined && item !== null && item !== ''),
  );
}
