import { Injectable } from '@nestjs/common';
import { JsonObject, Room } from '../../types';
import { StorageService } from '../../infrastructure/storage/storage.service';

@Injectable()
export class RoomService {
    constructor(private readonly storage: StorageService) { }

    listRooms(): Room[] {
        const rows = this.storage.all<JsonObject>(`
      SELECT rooms.*, floors.name AS floor_name,
             (SELECT COUNT(*) FROM devices WHERE devices.room_id = rooms.id) AS devices_count
      FROM rooms
      LEFT JOIN floors ON floors.id = rooms.floor_id
      ORDER BY COALESCE(floors.name, ''), rooms.name
    `);

        return rows.map(fromRoomRow);
    }

    getRoom(roomId: number): Room | null {
        const row = this.storage.get<JsonObject>(
            `
      SELECT rooms.*, floors.name AS floor_name,
             (SELECT COUNT(*) FROM devices WHERE devices.room_id = rooms.id) AS devices_count
      FROM rooms
      LEFT JOIN floors ON floors.id = rooms.floor_id
      WHERE rooms.id = ?
      `,
            [roomId],
        );

        return row ? fromRoomRow(row) : null;
    }

    createRoom(request: JsonObject): Room {
        const now = this.storage.utcNow();

        const result = this.storage.run(
            `
      INSERT INTO rooms
        (name, icon, floor_id, description, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      `,
            [
                request.name,
                request.icon,
                request.floorId,
                request.description,
                now,
                now,
            ],
        );

        return this.getRoom(Number(result.lastInsertRowid)) as Room;
    }

    updateRoom(roomId: number, request: JsonObject): Room | null {
        const current = this.getRoom(roomId);

        if (!current) return null;

        const fieldMap: Record<string, string> = {
            name: 'name',
            icon: 'icon',
            floorId: 'floor_id',
            floor_id: 'floor_id',
            description: 'description',
        };

        const assignments: string[] = [];
        const values: unknown[] = [];

        for (const [source, target] of Object.entries(fieldMap)) {
            if (has(request, source)) {
                assignments.push(`${target} = ?`);
                values.push(request[source]);
            }
        }

        if (!assignments.length) return current;

        assignments.push('updated_at = ?');
        values.push(this.storage.utcNow());

        values.push(roomId);

        this.storage.run(
            `UPDATE rooms SET ${assignments.join(', ')} WHERE id = ?`,
            values,
        );

        return this.getRoom(roomId);
    }

    deleteRoom(roomId: number): boolean {
        return this.storage.transaction(() => {
            this.storage.run(
                'UPDATE devices SET room_id = NULL WHERE room_id = ?',
                [roomId],
            );

            return this.storage.run(
                'DELETE FROM rooms WHERE id = ?',
                [roomId],
            ).changes > 0;
        });
    }
}

function fromRoomRow(row: JsonObject): Room {
    return {
        id: row.id,
        name: row.name,
        icon: row.icon,
        floorId: row.floor_id,
        floorName: row.floor_name,
        devicesCount: row.devices_count,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

function has(value: JsonObject, key: string): boolean {
    return Object.prototype.hasOwnProperty.call(value || {}, key);
}