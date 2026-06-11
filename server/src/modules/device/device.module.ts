import { Module } from '@nestjs/common';
import { DeviceController } from './device.controller';
import { DEVICE_SERVICE, DeviceService } from './device.service';

@Module({
    controllers: [DeviceController],
    providers: [DeviceService, { provide: DEVICE_SERVICE, useExisting: DeviceService }],
    exports: [DeviceService, DEVICE_SERVICE],
})
export class DeviceModule { }