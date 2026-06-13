import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res } from '@nestjs/common';
import { CommandRequest, JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { DeviceService } from './device.service';

@Controller('devices')
export class DeviceController {
    constructor(
        private readonly deviceService: DeviceService,
        private readonly commonService: CommonService,
    ) { }

    @Get()
    listDevices() {
        return this.deviceService.listDevices();
    }

    @Post('auto-link-local')
    autoLinkLocalDevices() {
        return this.deviceService.autoLinkLocalDevices();
    }

    @Post('reconcile-local')
    reconcileLocalAvailability() {
        return this.deviceService.reconcileLocalAvailability();
    }

    @Post()
    createDevice(@Body() body: JsonObject) {
        return this.deviceService.createDevice(body);
    }

    @Get(':device_id/configuration')
    getDeviceConfiguration(@Param('device_id') deviceId: string) {
        const configuration = this.deviceService.getDeviceConfiguration(Number(deviceId));
        if (!configuration) throw this.commonService.notFound('Device not found');
        return configuration;
    }

    @Get(':device_id/stream.mjpeg')
    streamCameraMjpeg(@Param('device_id') deviceId: string, @Res() response: any) {
        if (!this.deviceService.streamCameraMjpeg(Number(deviceId), response)) {
            throw this.commonService.notFound('Camera not found');
        }
    }

    @Get(':device_id')
    getDevice(@Param('device_id') deviceId: string) {
        const device = this.deviceService.getDevice(Number(deviceId));
        if (!device) throw this.commonService.notFound('Device not found');
        return device;
    }

    @Get(':device_id/history')
    getDeviceHistory(@Param('device_id') deviceId: string, @Query('limit') limit?: string) {
        const id = Number(deviceId);
        const device = this.deviceService.getDevice(id);
        if (!device) throw this.commonService.notFound('Device not found');
        return this.deviceService.listDeviceHistory(id, Number(limit || 40));
    }

    @Patch(':device_id')
    updateDevice(@Param('device_id') deviceId: string, @Body() body: JsonObject) {
        const device = this.deviceService.updateDevice(Number(deviceId), body);
        if (!device) throw this.commonService.notFound('Device not found');
        return device;
    }

    @Post(':device_id/link-local')
    linkLocalDevice(@Param('device_id') deviceId: string, @Body() body: JsonObject) {
        const device = this.deviceService.linkLocalDevice(Number(deviceId), body);
        if (!device) throw this.commonService.notFound('Device not found');
        return device;
    }

    @Post(':device_id/auto-link-local')
    autoLinkLocalDevice(@Param('device_id') deviceId: string) {
        const device = this.deviceService.autoLinkLocalDevice(Number(deviceId));
        if (!device) throw this.commonService.notFound('Device not found');
        return device;
    }

    @Post(':device_id/command')
    async commandDevice(@Param('device_id') deviceId: string, @Body() body: CommandRequest) {
        const result = await this.deviceService.commandDevice(Number(deviceId), body);
        if (!result) throw this.commonService.notFound('Device not found');
        return result;
    }

    @Get(':device_id/status')
    async deviceStatus(@Param('device_id') deviceId: string) {
        const result = await this.deviceService.deviceStatus(Number(deviceId));
        if (!result) throw this.commonService.notFound('Device not found');
        return result;
    }

    @Delete(':device_id')
    deleteDevice(@Param('device_id') deviceId: string) {
        if (!this.deviceService.deleteDevice(Number(deviceId))) throw this.commonService.notFound('Device not found');
        return { deleted: true };
    }
}
