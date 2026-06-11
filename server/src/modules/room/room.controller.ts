import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { RoomService } from "./room.service";
import { CommonService } from "../common/common.service";
import { JsonObject } from "../../types";

@Controller('rooms')
export class RoomController {
    constructor(
        private readonly roomService: RoomService,
        private readonly commonService: CommonService
    ) { }

    @Get()
    listRooms() {
        return this.roomService.listRooms();
    }

    @Get(':room_id')
    getRoom(@Param('room_id') roomId: string) {
        const room = this.roomService.getRoom(Number(roomId));
        if (!room) throw this.commonService.notFound('Room not found');
        return room;
    }

    @Post()
    createRoom(@Body() body: JsonObject) {
        return this.roomService.createRoom(body);
    }

    @Patch(':room_id')
    updateRoom(@Param('room_id') roomId: string, @Body() body: JsonObject) {
        const room = this.roomService.updateRoom(Number(roomId), body);
        if (!room) throw this.commonService.notFound('Room not found');
        return room;
    }

    @Delete(':room_id')
    deleteRoom(@Param('room_id') roomId: string) {
        if (!this.roomService.deleteRoom(Number(roomId))) throw this.commonService.notFound('Room not found');
        return { deleted: true };
    }
}
