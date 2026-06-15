import { BadRequestException, Body, Controller, Get, Post } from '@nestjs/common';
import { BackupService } from './backup.service';

@Controller('backup')
export class BackupController {
    constructor(private readonly backupService: BackupService) { }

    @Get()
    exportBackup() {
        return this.backupService.exportBackup();
    }

    @Post('restore')
    restoreBackup(@Body() body: unknown) {
        try {
            return this.backupService.restoreBackup(body);
        } catch (error) {
            throw new BadRequestException(messageFrom(error));
        }
    }
}

function messageFrom(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}
