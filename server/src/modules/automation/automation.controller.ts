import { Body, Controller, Delete, Get, HttpException, HttpStatus, Param, Patch, Post, Query } from '@nestjs/common';
import { JsonObject } from '../../types';
import { CommonService } from '../common/common.service';
import { AutomationService } from './automation.service';

@Controller('automations')
export class AutomationController {
    constructor(
        private readonly automationService: AutomationService,
        private readonly commonService: CommonService,
    ) { }

    @Get()
    listAutomations() {
        return this.automationService.listAutomations();
    }

    @Get(':automation_id/runs')
    listAutomationRuns(@Param('automation_id') automationId: string, @Query('limit') limit?: string) {
        const id = Number(automationId);
        const automation = this.automationService.getAutomation(id);
        if (!automation) throw this.commonService.notFound('Automation not found');
        return this.automationService.listAutomationRuns(id, Number(limit || 10));
    }

    @Get(':automation_id')
    getAutomation(@Param('automation_id') automationId: string) {
        const automation = this.automationService.getAutomation(Number(automationId));
        if (!automation) throw this.commonService.notFound('Automation not found');
        return automation;
    }

    @Post()
    createAutomation(@Body() body: JsonObject) {
        try {
            return this.automationService.createAutomation(body);
        } catch (error) {
            throw this.commonService.badRequest(this.commonService.messageFrom(error));
        }
    }

    @Patch(':automation_id')
    updateAutomation(@Param('automation_id') automationId: string, @Body() body: JsonObject) {
        try {
            const automation = this.automationService.updateAutomation(Number(automationId), body);
            if (!automation) throw this.commonService.notFound('Automation not found');
            return automation;
        } catch (error) {
            if (error instanceof HttpException && error.getStatus() === HttpStatus.NOT_FOUND) throw error;
            throw this.commonService.badRequest(this.commonService.messageFrom(error));
        }
    }

    @Delete(':automation_id')
    deleteAutomation(@Param('automation_id') automationId: string) {
        if (!this.automationService.deleteAutomation(Number(automationId))) throw this.commonService.notFound('Automation not found');
        return { deleted: true };
    }
}