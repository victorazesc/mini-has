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
  rooms.name AS room_name
FROM floors
LEFT JOIN rooms ON rooms.floor_id = floors.id
ORDER BY floors.id
        `);
        return rows.map((row) => this.fromFloorRow(row));

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
            updatedAt: this.storage.utcNow(),
        };

        this.storage.run(
            `
            UPDATE floors
            SET name = ?, description = ?, updated_at = ?
            WHERE id = ?
            `,
            [updated.name, updated.description || null, updated.updatedAt, id],
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

    private fromFloorRow(row: JsonObject): Floor {
        return {
            id: row.id,
            name: row.name,
            description: row.description,
            createdAt: row.created_at,
            updatedAt: row.updated_at,
        };
    }
}

export type Floor = {
    id: number;
    name: string;
    description?: string;
    createdAt: string;
    updatedAt: string;
};

export type CreateFloorDto = {
    name: string;
    description?: string;
};

export type UpdateFloorDto = {
    name?: string;
    description?: string;
};