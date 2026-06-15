import { Module } from '@nestjs/common';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { BackupController } from './backup.controller';
import { BackupService } from './backup.service';

@Module({
    controllers: [BackupController],
    providers: [BackupService, StorageService],
})
export class BackupModule { }
