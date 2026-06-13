import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { CommandRequest, JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { EntityService } from './entity.service';

@Controller('entities')
export class EntityController {
    constructor(
        private readonly entityService: EntityService,
        private readonly commonService: CommonService,
    ) { }

    @Get()
    listEntities() {
        return this.entityService.listEntities();
    }

    @Get(':entity_id')
    getEntity(@Param('entity_id') entityId: string) {
        const entity = this.entityService.getEntity(Number(entityId));
        if (!entity) throw this.commonService.notFound('Entity not found');
        return entity;
    }

    @Patch(':entity_id')
    updateEntity(@Param('entity_id') entityId: string, @Body() body: JsonObject) {
        const entity = this.entityService.updateEntity(Number(entityId), body);
        if (!entity) throw this.commonService.notFound('Entity not found');
        return entity;
    }

    @Post(':entity_id/command')
    commandEntity(@Param('entity_id') entityId: string, @Body() body: CommandRequest) {
        const result = this.entityService.commandEntity(Number(entityId), body);
        if (!result) throw this.commonService.notFound('Entity not found');
        return result;
    }
}
