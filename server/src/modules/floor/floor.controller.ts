import {
    Controller,
    Get,
    Param,
    Post,
    Body,
    Patch,
    Delete,
    Put
} from "@nestjs/common";
import { Floor, FloorService, UpsertFloorDevicePositionDto } from "./floor.service";
import { JsonObject } from "../../types";
import { CommonService } from "../common/common.service";

@Controller('floors')
export class FloorController {
    constructor(
        private readonly floorService: FloorService,
        private readonly commonService: CommonService) { }

    @Get()
    listFloors() {
        return this.floorService.getFloors();
    }

    @Get(':floor_id/device-positions')
    async getFloorDevicePositions(@Param('floor_id') floorId: string) {
        try {
            return await this.floorService.getDevicePositions(Number(floorId));
        } catch (error) {
            throw this.commonService.notFound(this.commonService.messageFrom(error));
        }
    }

    @Put(':floor_id/device-positions')
    async replaceFloorDevicePositions(
        @Param('floor_id') floorId: string,
        @Body() body: { positions?: UpsertFloorDevicePositionDto[] },
    ) {
        try {
            return await this.floorService.replaceDevicePositions(
                Number(floorId),
                body.positions ?? [],
            );
        } catch (error) {
            const message = this.commonService.messageFrom(error);

            if (message === 'Floor not found') {
                throw this.commonService.notFound(message);
            }

            throw this.commonService.badRequest(message);
        }
    }

    @Get(':floor_id')
    getFloor(@Param('floor_id') floorId: string) {
        const floor = this.floorService.getFloorById(Number(floorId));
        if (!floor) throw this.commonService.notFound('Floor not found');
        return floor;
    }

    @Post()
    createFloor(@Body() body: Floor) {
        return this.floorService.createFloor(body);
    }

    @Patch(':floor_id')
    updateFloor(@Param('floor_id') floorId: string, @Body() body: JsonObject) {
        const floor = this.floorService.updateFloor(Number(floorId), body);
        if (!floor) throw this.commonService.notFound('Floor not found');
        return floor;
    }

    @Delete(':floor_id')
    deleteFloor(@Param('floor_id') floorId: string) {
        if (!this.floorService.deleteFloor(Number(floorId))) throw this.commonService.notFound('Floor not found');
        return { deleted: true };
    }
}
