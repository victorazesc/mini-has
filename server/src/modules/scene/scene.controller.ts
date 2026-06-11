import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { SceneService } from './scene.service';

@Controller('scenes')
export class SceneController {
    constructor(
        private readonly sceneService: SceneService,
        private readonly commonService: CommonService,
    ) { }

    @Get()
    listScenes() {
        return this.sceneService.listScenes();
    }

    @Get(':scene_id')
    getScene(@Param('scene_id') sceneId: string) {
        const scene = this.sceneService.getScene(Number(sceneId));
        if (!scene) throw this.commonService.notFound('Scene not found');
        return scene;
    }

    @Get(':scene_id/runs')
    listSceneRuns(@Param('scene_id') sceneId: string, @Query('limit') limit?: string) {
        const id = Number(sceneId);
        const scene = this.sceneService.getScene(id);
        if (!scene) throw this.commonService.notFound('Scene not found');
        return this.sceneService.listSceneRuns(id, Number(limit || 10));
    }

    @Post()
    createScene(@Body() body: JsonObject) {
        try {
            return this.sceneService.createScene(body);
        } catch (error) {
            throw this.commonService.badRequest(this.commonService.messageFrom(error));
        }
    }

    @Patch(':scene_id')
    updateScene(@Param('scene_id') sceneId: string, @Body() body: JsonObject) {
        try {
            const scene = this.sceneService.updateScene(Number(sceneId), body);
            if (!scene) throw this.commonService.notFound('Scene not found');
            return scene;
        } catch (error) {
            if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) throw error;
            throw this.commonService.badRequest(this.commonService.messageFrom(error));
        }
    }

    @Delete(':scene_id')
    deleteScene(@Param('scene_id') sceneId: string) {
        if (!this.sceneService.deleteScene(Number(sceneId))) throw this.commonService.notFound('Scene not found');
        return { deleted: true };
    }

    @Post(':scene_id/run')
    async runScene(@Param('scene_id') sceneId: string) {
        const run = await this.sceneService.runScene(Number(sceneId));
        if (!run) throw this.commonService.notFound('Scene not found');
        return run;
    }
}