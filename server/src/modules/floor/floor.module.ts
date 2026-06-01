import { Module } from '@nestjs/common';
import { FloorController } from './floor.controller';
import { FloorService } from './floor.service';
import { StorageService } from '../../storage';
import { CommonService } from '../common/common.service';
@Module({
    controllers: [
        FloorController
    ],
    providers: [
        FloorService,
        StorageService,
        CommonService
    ],
})
export class FloorModule { }
