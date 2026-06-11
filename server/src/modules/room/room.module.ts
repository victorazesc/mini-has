import { Module } from '@nestjs/common';
import { RoomController } from './room.controller';
import { RoomService } from './room.service';
import { StorageService } from '../../infrastructure/storage/storage.service';
import { CommonService } from '../common/common.service';

@Module({
    controllers: [
        RoomController
    ],
    providers: [
        RoomService,
        StorageService,
        CommonService
    ],
    exports: [
        RoomService,
        StorageService,
    ],
})
export class RoomModule { }
