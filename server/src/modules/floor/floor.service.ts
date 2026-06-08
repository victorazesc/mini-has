import { JsonObject } from '../../types';
import { StorageService } from '../../storage';
import { Injectable } from '@nestjs/common';

@Injectable()
export class FloorService {
    constructor(private readonly storage: StorageService) { }

    async getFloors(): Promise<Floor[]> {

        const rows = this.storage.all<JsonObject>(`
  SELECT 
  floors.*,
  count(DISTINCT rooms.id) AS room_count
FROM floors
LEFT JOIN rooms ON rooms.floor_id = floors.id
GROUP BY floors.id
ORDER BY floors.id
        `);

        const floors = rows.map((row) => this.fromFloorRow(row));
        return floors;

    }

    async getFloorById(id: number): Promise<Floor | null> {
        const row = this.storage.get<JsonObject>(
            `
            SELECT floor.*
            FROM floors floor
            WHERE floor.id = ?
            `,
            [id],
        );
        return row ? this.fromFloorRow(row) : null;
    }

    async createFloor(data: CreateFloorDto): Promise<Floor> {
        const now = this.storage.utcNow();
        const result = this.storage.run(
            `
            INSERT INTO floors (name, description, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            `,
            [data.name, data.description || null, now, now],
        );
        return {
            id: result.lastInsertRowid as number,
            name: data.name,
            description: data.description,
            createdAt: now,
            updatedAt: now,
        };
    }

    async updateFloor(id: number, data: UpdateFloorDto): Promise<Floor> {
        const existing = await this.getFloorById(id);
        if (!existing) {
            throw new Error("Floor not found");
        }

        const updated = {
            ...existing,
            name: data.name ?? existing.name,
            description: data.description ?? existing.description,
            modelUrl: data.modelUrl ?? existing.modelUrl,
            updatedAt: this.storage.utcNow(),
        };

        this.storage.run(
            `
            UPDATE floors
            SET name = ?, description = ?, model_url = ?, updated_at = ?
            WHERE id = ?
            `,
            [updated.name, updated.description || null, updated.modelUrl || null, updated.updatedAt, id],
        );

        return updated;
    }

    async deleteFloor(id: number): Promise<void> {
        if (!await this.getFloorById(id)) {
            throw new Error("Floor not found");
        }
        this.storage.run(
            `
            DELETE FROM floors
            WHERE id = ?
            `,
            [id],
        );
    }

    async getDevicePositions(floorId: number): Promise<FloorDevicePosition[]> {
        const floor = await this.getFloorById(floorId);

        if (!floor) {
            throw new Error("Floor not found");
        }

        const rows = this.storage.all<JsonObject>(
            `
            SELECT
                position.floor_id,
                position.device_id,
                position.x,
                position.y,
                position.z,
                position.created_at,
                position.updated_at
            FROM floor_device_positions position
            INNER JOIN devices device ON device.id = position.device_id
            INNER JOIN rooms room ON room.id = device.room_id
            WHERE position.floor_id = ?
              AND room.floor_id = ?
            ORDER BY position.device_id
            `,
            [floorId, floorId],
        );

        return rows.map((row) => this.fromDevicePositionRow(row));
    }

    async replaceDevicePositions(
        floorId: number,
        positions: UpsertFloorDevicePositionDto[],
    ): Promise<FloorDevicePosition[]> {
        const floor = await this.getFloorById(floorId);

        if (!floor) {
            throw new Error("Floor not found");
        }

        const deviceIds = positions.map((position) => position.deviceId);

        if (new Set(deviceIds).size !== deviceIds.length) {
            throw new Error("Duplicate device position");
        }

        for (const position of positions) {
            if (
                !Number.isFinite(position.deviceId) ||
                !Number.isFinite(position.x) ||
                !Number.isFinite(position.y) ||
                !Number.isFinite(position.z)
            ) {
                throw new Error("Invalid device position");
            }
        }

        const allowedDeviceIds = new Set(
            this.storage
                .all<{ id: number }>(
                    `
                    SELECT device.id
                    FROM devices device
                    INNER JOIN rooms room ON room.id = device.room_id
                    WHERE room.floor_id = ?
                    `,
                    [floorId],
                )
                .map((device) => device.id),
        );

        for (const position of positions) {
            if (!allowedDeviceIds.has(position.deviceId)) {
                throw new Error("Device does not belong to floor");
            }
        }

        const now = this.storage.utcNow();

        this.storage.transaction(() => {
            this.storage.run(
                `
                DELETE FROM floor_device_positions
                WHERE floor_id = ?
                `,
                [floorId],
            );

            for (const position of positions) {
                this.storage.run(
                    `
                    INSERT INTO floor_device_positions (
                        floor_id,
                        device_id,
                        x,
                        y,
                        z,
                        created_at,
                        updated_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    `,
                    [
                        floorId,
                        position.deviceId,
                        position.x,
                        position.y,
                        position.z,
                        now,
                        now,
                    ],
                );
            }
        });

        return this.getDevicePositions(floorId);
    }

    private fromFloorRow(row: JsonObject): Floor {
        return {
            id: row.id,
            name: row.name,
            roomsCount: row.room_count,
            description: row.description,
            modelUrl: row.model_url,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }

    private fromDevicePositionRow(row: JsonObject): FloorDevicePosition {
        return {
            floorId: row.floor_id,
            deviceId: row.device_id,
            x: row.x,
            y: row.y,
            z: row.z,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export type Floor = {
    id: number;
    name: string;
    description?: string;
    modelUrl?: string;
    createdAt: string;
    updatedAt: string;
    roomsCount?: number;
};

export type CreateFloorDto = {
    name: string;
    description?: string;
};

export type UpdateFloorDto = {
    name?: string;
    description?: string;
    modelUrl?: string;
};

export type FloorDevicePosition = {
    floorId: number;
    deviceId: number;
    x: number;
    y: number;
    z: number;
    createdAt: string;
    updatedAt: string;
};

export type UpsertFloorDevicePositionDto = {
    deviceId: number;
    x: number;
    y: number;
    z: number;
};
