import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DeviceModule } from '../device/device.module';
import { SceneModule } from '../scene/scene.module';
import { McpAccessService } from './mcp-access.service';
import { McpController } from './mcp.controller';
import { McpService } from './mcp.service';

@Module({
    imports: [AuthModule, DeviceModule, SceneModule],
    controllers: [McpController],
    providers: [McpService, McpAccessService],
    exports: [McpService, McpAccessService],
})
export class McpModule { }
