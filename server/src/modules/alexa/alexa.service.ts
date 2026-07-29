import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Device, JsonObject } from '../../types';
import { DeviceService } from '../device/device.service';
import { SceneService } from '../scene/scene.service';
import {
    alexaBrightness,
    alexaOpeningToMiniHas,
    brightnessCommand,
    brightnessProperty,
    clampPercent,
    climateMode,
    climateTargetCelsius,
    deviceIsOnline,
    deviceStateProperties,
    deviceToAlexaEndpoint,
    endpointHealthProperty,
    isAlexaControllableDevice,
    isAlexaClimateDevice,
    isAlexaCoverDevice,
    isAlexaPowerDevice,
    isAlexaSafeScene,
    miniHasCoverPosition,
    miniHasToAlexaOpening,
    percentageProperty,
    powerStateProperty,
    rangeValueProperty,
    sceneToAlexaEndpoint,
    thermostatModeProperty,
    thermostatTargetProperty,
} from './alexa.mapper';
import { parseEndpointTarget } from './alexa.schemas';
import {
    AlexaDirective,
    AlexaEndpointReference,
    AlexaErrorType,
    AlexaResponse,
} from './alexa.types';

class AlexaDirectiveError extends Error {
    constructor(
        readonly type: AlexaErrorType,
        readonly safeMessage: string,
    ) {
        super(safeMessage);
        this.name = 'AlexaDirectiveError';
    }
}

@Injectable()
export class AlexaService {
    private readonly logger = new Logger(AlexaService.name);

    constructor(
        private readonly devices: DeviceService,
        private readonly scenes: SceneService,
    ) { }

    async handleDirective(directive: AlexaDirective): Promise<AlexaResponse> {
        try {
            return await this.route(directive);
        } catch (error) {
            const alexaError = error instanceof AlexaDirectiveError
                ? error
                : new AlexaDirectiveError('INTERNAL_ERROR', 'Unable to complete the request');
            this.logger.warn(
                `Directive ${directive.header.namespace}/${directive.header.name} failed`
                + ` for ${directive.endpoint?.endpointId || 'discovery'}: ${alexaError.type}`,
            );
            return this.errorResponse(directive, alexaError.type, alexaError.safeMessage);
        }
    }

    private async route(directive: AlexaDirective): Promise<AlexaResponse> {
        const { namespace, name } = directive.header;

        if (namespace === 'Alexa.Discovery' && name === 'Discover') {
            return this.discoveryResponse(directive);
        }
        if (namespace === 'Alexa' && name === 'ReportState') {
            return this.reportState(directive);
        }
        if (namespace === 'Alexa.PowerController') {
            return this.controlPower(directive);
        }
        if (namespace === 'Alexa.BrightnessController') {
            return this.controlBrightness(directive);
        }
        if (namespace === 'Alexa.RangeController') {
            return this.controlCoverRange(directive);
        }
        if (namespace === 'Alexa.PercentageController') {
            return this.controlCoverPercentage(directive);
        }
        if (namespace === 'Alexa.SceneController') {
            return this.controlScene(directive);
        }
        if (namespace === 'Alexa.ThermostatController') {
            return this.controlThermostat(directive);
        }
        throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported directive');
    }

    private discoveryResponse(directive: AlexaDirective): AlexaResponse {
        const devices = this.devices.listDevices();
        const devicesById = new Map(devices.map((device) => [device.id, device]));
        const endpoints = [
            ...devices
                .filter((device) => isAlexaControllableDevice(device))
                .map(deviceToAlexaEndpoint),
            ...this.scenes.listScenes()
                .filter((scene) => isAlexaSafeScene(
                    scene,
                    (deviceId) => devicesById.get(deviceId),
                ))
                .map(sceneToAlexaEndpoint),
        ].slice(0, maxDiscoveryEndpoints());

        return {
            event: {
                header: {
                    namespace: 'Alexa.Discovery',
                    name: 'Discover.Response',
                    messageId: randomUUID(),
                    payloadVersion: '3',
                },
                payload: { endpoints },
            },
        };
    }

    private async reportState(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = await this.freshDevice(this.deviceTarget(directive));
        const properties = deviceStateProperties(device);
        if (!properties.length) {
            throw new AlexaDirectiveError(
                'ENDPOINT_UNREACHABLE',
                'The endpoint state is unavailable',
            );
        }
        properties.push(endpointHealthProperty(device));

        return this.endpointResponse(directive, 'StateReport', properties);
    }

    private async controlPower(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = this.deviceTarget(directive);
        if (!isAlexaPowerDevice(device)) {
            throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Power control is not supported');
        }

        let command: 'turn_on' | 'turn_off';
        let powerState: 'ON' | 'OFF';
        if (directive.header.name === 'TurnOn') {
            command = 'turn_on';
            powerState = 'ON';
        } else if (directive.header.name === 'TurnOff') {
            command = 'turn_off';
            powerState = 'OFF';
        } else {
            throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported power directive');
        }

        const updated = await this.commandDevice(device, command);
        return this.endpointResponse(directive, 'Response', [
            powerStateProperty(updated, powerState),
            endpointHealthProperty(updated),
        ]);
    }

    private async controlCoverRange(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = this.coverTarget(directive);
        const alexaOpening = this.coverTargetValue(
            directive,
            'rangeValue',
            'rangeValueDelta',
            device,
        );
        const updated = await this.setCoverPosition(device, alexaOpening);
        return this.endpointResponse(directive, 'Response', [
            rangeValueProperty(updated, alexaOpening),
            endpointHealthProperty(updated),
        ]);
    }

    private async controlCoverPercentage(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = this.coverTarget(directive);
        const alexaOpening = this.coverTargetValue(
            directive,
            'percentage',
            'percentageDelta',
            device,
        );
        const updated = await this.setCoverPosition(device, alexaOpening);
        return this.endpointResponse(directive, 'Response', [
            percentageProperty(updated, alexaOpening),
            endpointHealthProperty(updated),
        ]);
    }

    private async controlBrightness(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = this.deviceTarget(directive);
        const current = alexaBrightness(device);
        if (current === null) {
            throw new AlexaDirectiveError(
                'INVALID_DIRECTIVE',
                'Brightness control is not supported',
            );
        }

        let requested: number;
        if (directive.header.name === 'SetBrightness') {
            requested = finiteNumber(directive.payload.brightness);
        } else if (directive.header.name === 'AdjustBrightness') {
            requested = current + finiteNumber(directive.payload.brightnessDelta);
        } else {
            throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported brightness directive');
        }
        if (requested < 0 || requested > 100) {
            throw new AlexaDirectiveError(
                'VALUE_OUT_OF_RANGE',
                'Brightness must be between 0 and 100',
            );
        }

        const brightness = clampPercent(requested);
        if (brightness === 0) {
            const updated = await this.commandDevice(device, 'turn_off');
            return this.endpointResponse(directive, 'Response', [
                brightnessProperty(updated, 0),
                powerStateProperty(updated, 'OFF'),
                endpointHealthProperty(updated),
            ]);
        }

        const command = brightnessCommand(device, brightness);
        if (!command) {
            throw new AlexaDirectiveError(
                'INVALID_DIRECTIVE',
                'Brightness control is not supported',
            );
        }
        const powered = await this.commandDevice(device, 'turn_on');
        const updated = await this.commandDevice(powered, 'set', command);
        return this.endpointResponse(directive, 'Response', [
            brightnessProperty(updated, brightness),
            powerStateProperty(updated, 'ON'),
            endpointHealthProperty(updated),
        ]);
    }

    private async controlThermostat(directive: AlexaDirective): Promise<AlexaResponse> {
        const device = this.deviceTarget(directive);
        if (!isAlexaClimateDevice(device)) {
            throw new AlexaDirectiveError(
                'INVALID_DIRECTIVE',
                'Thermostat control is not supported',
            );
        }

        if (directive.header.name === 'SetTargetTemperature') {
            const target = temperatureToCelsius(directive.payload.targetSetpoint);
            return this.setClimateTarget(directive, device, target);
        }
        if (directive.header.name === 'AdjustTargetTemperature') {
            const current = climateTargetCelsius(device);
            if (current === null) {
                throw new AlexaDirectiveError(
                    'ENDPOINT_UNREACHABLE',
                    'The target temperature is unavailable',
                );
            }
            const delta = temperatureDeltaToCelsius(
                directive.payload.targetSetpointDelta,
            );
            return this.setClimateTarget(directive, device, current + delta);
        }
        if (directive.header.name === 'SetThermostatMode') {
            const requested = thermostatModeValue(directive.payload.thermostatMode);
            if (requested === 'OFF') {
                const updated = await this.commandDevice(device, 'turn_off');
                return this.endpointResponse(directive, 'Response', [
                    thermostatModeProperty(updated, 'OFF'),
                    endpointHealthProperty(updated),
                ]);
            }
            if (requested !== 'COOL' && requested !== 'AUTO') {
                throw new AlexaDirectiveError(
                    'UNSUPPORTED_THERMOSTAT_MODE',
                    'The requested thermostat mode is not supported',
                );
            }
            const updated = await this.commandDevice(device, 'set', {
                commands: [
                    {
                        component: 'main',
                        capability: 'switch',
                        command: 'on',
                    },
                    {
                        component: 'main',
                        capability: 'airConditionerMode',
                        command: 'setAirConditionerMode',
                        arguments: [requested.toLowerCase()],
                    },
                ],
            });
            return this.endpointResponse(directive, 'Response', [
                thermostatModeProperty(updated, requested),
                endpointHealthProperty(updated),
            ]);
        }

        throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported thermostat directive');
    }

    private async setClimateTarget(
        directive: AlexaDirective,
        device: Device,
        targetCelsius: number,
    ): Promise<AlexaResponse> {
        if (targetCelsius < 16 || targetCelsius > 30) {
            throw new AlexaDirectiveError(
                'TEMPERATURE_VALUE_OUT_OF_RANGE',
                'Temperature must be between 16 and 30 Celsius',
            );
        }
        const target = Math.round(targetCelsius * 2) / 2;
        const updated = await this.commandDevice(device, 'set', {
            commands: [{
                component: 'main',
                capability: 'thermostatCoolingSetpoint',
                command: 'setCoolingSetpoint',
                arguments: [target],
            }],
        });
        return this.endpointResponse(directive, 'Response', [
            thermostatTargetProperty(updated, target),
            ...(climateMode(updated)
                ? [thermostatModeProperty(updated, climateMode(updated)!)]
                : []),
            endpointHealthProperty(updated),
        ]);
    }

    private async controlScene(directive: AlexaDirective): Promise<AlexaResponse> {
        const target = this.endpointTarget(directive);
        if (target.kind !== 'scene') {
            throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Scene not found');
        }
        if (directive.header.name === 'Deactivate') {
            throw new AlexaDirectiveError(
                'NOT_SUPPORTED_IN_CURRENT_MODE',
                'Scene deactivation is not supported',
            );
        }
        if (directive.header.name !== 'Activate') {
            throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported scene directive');
        }

        const scene = this.scenes.getScene(target.id);
        if (!scene || !isAlexaSafeScene(
            scene,
            (deviceId) => this.devices.getDevice(deviceId),
        )) {
            throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Scene not found');
        }

        const run = await this.scenes.runScene(target.id, {
            source: 'alexa',
            directiveMessageId: directive.header.messageId,
        });
        if (!run) throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Scene not found');
        if (run.status !== 'success') {
            throw new AlexaDirectiveError(
                'ENDPOINT_UNREACHABLE',
                'The scene could not be completed',
            );
        }

        return {
            event: {
                header: responseHeader(
                    directive,
                    'Alexa.SceneController',
                    'ActivationStarted',
                ),
                endpoint: responseEndpoint(directive.endpoint),
                payload: {
                    cause: { type: 'VOICE_INTERACTION' },
                    timestamp: new Date().toISOString(),
                },
            },
        };
    }

    private coverTargetValue(
        directive: AlexaDirective,
        setField: string,
        deltaField: string,
        device: Device,
    ): number {
        const { name } = directive.header;
        if (name.startsWith('Set')) {
            const requested = finiteNumber(directive.payload[setField]);
            if (requested < 0 || requested > 100) {
                throw new AlexaDirectiveError(
                    'VALUE_OUT_OF_RANGE',
                    'Position must be between 0 and 100',
                );
            }
            return clampPercent(requested);
        }
        if (name.startsWith('Adjust')) {
            const delta = finiteNumber(directive.payload[deltaField]);
            const currentMiniHasPosition = miniHasCoverPosition(device);
            if (currentMiniHasPosition === null) {
                throw new AlexaDirectiveError(
                    'ENDPOINT_UNREACHABLE',
                    'The endpoint state is unavailable',
                );
            }
            return clampPercent(
                miniHasToAlexaOpening(currentMiniHasPosition) + delta,
            );
        }
        throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported position directive');
    }

    private async setCoverPosition(device: Device, alexaOpening: number): Promise<Device> {
        return this.commandDevice(device, 'set_position', {
            position: alexaOpeningToMiniHas(alexaOpening),
        });
    }

    private async commandDevice(
        device: Device,
        command: string,
        params: JsonObject = {},
    ): Promise<Device> {
        const result = await this.devices.commandDevice(device.id, { command, params });
        if (!result) throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Device not found');
        if (!result.ok) {
            throw new AlexaDirectiveError(
                'ENDPOINT_UNREACHABLE',
                'The endpoint did not accept the command',
            );
        }
        return this.devices.getDevice(device.id) || device;
    }

    private async freshDevice(device: Device): Promise<Device> {
        try {
            const result = await this.devices.deviceStatus(device.id);
            if (result?.device) return result.device;
        } catch {
            // Cached state remains useful; EndpointHealth marks stale/offline devices.
        }
        return this.devices.getDevice(device.id) || device;
    }

    private coverTarget(directive: AlexaDirective): Device {
        const device = this.deviceTarget(directive);
        if (!isAlexaCoverDevice(device)) {
            throw new AlexaDirectiveError(
                'INVALID_DIRECTIVE',
                'Position control is not supported',
            );
        }
        return device;
    }

    private deviceTarget(directive: AlexaDirective): Device {
        const target = this.endpointTarget(directive);
        if (target.kind !== 'device') {
            throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Device not found');
        }
        const device = this.devices.getDevice(target.id);
        if (!device || !isAlexaControllableDevice(device)) {
            throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Device not found');
        }
        return device;
    }

    private endpointTarget(directive: AlexaDirective) {
        const endpointId = directive.endpoint?.endpointId;
        const target = endpointId ? parseEndpointTarget(endpointId) : null;
        if (!target) throw new AlexaDirectiveError('NO_SUCH_ENDPOINT', 'Endpoint not found');
        return target;
    }

    private endpointResponse(
        directive: AlexaDirective,
        name: 'Response' | 'StateReport',
        properties: JsonObject[],
    ): AlexaResponse {
        return {
            event: {
                header: responseHeader(directive, 'Alexa', name),
                endpoint: responseEndpoint(directive.endpoint),
                payload: {},
            },
            context: { properties },
        };
    }

    private errorResponse(
        directive: AlexaDirective,
        type: AlexaErrorType,
        message: string,
    ): AlexaResponse {
        const event: JsonObject = {
            header: responseHeader(directive, 'Alexa', 'ErrorResponse'),
            payload: { type, message },
        };
        if (directive.endpoint) event.endpoint = responseEndpoint(directive.endpoint);
        return { event };
    }
}

function responseHeader(
    directive: AlexaDirective,
    namespace: string,
    name: string,
): JsonObject {
    const header: JsonObject = {
        namespace,
        name,
        messageId: randomUUID(),
        payloadVersion: '3',
    };
    if (directive.header.correlationToken) {
        header.correlationToken = directive.header.correlationToken;
    }
    return header;
}

function responseEndpoint(endpoint: AlexaEndpointReference | undefined): JsonObject {
    if (!endpoint) return {};
    const response: JsonObject = { endpointId: endpoint.endpointId };
    if (endpoint.scope) response.scope = endpoint.scope;
    return response;
}

function finiteNumber(value: unknown): number {
    const number = typeof value === 'number' ? value : Number.NaN;
    if (!Number.isFinite(number)) {
        throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'A numeric value is required');
    }
    return number;
}

function temperatureToCelsius(value: unknown): number {
    const temperature = temperatureObject(value);
    if (temperature.scale === 'CELSIUS') return temperature.value;
    if (temperature.scale === 'FAHRENHEIT') return (temperature.value - 32) * 5 / 9;
    if (temperature.scale === 'KELVIN') return temperature.value - 273.15;
    throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported temperature scale');
}

function temperatureDeltaToCelsius(value: unknown): number {
    const temperature = temperatureObject(value);
    if (temperature.scale === 'CELSIUS' || temperature.scale === 'KELVIN') {
        return temperature.value;
    }
    if (temperature.scale === 'FAHRENHEIT') return temperature.value * 5 / 9;
    throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Unsupported temperature scale');
}

function temperatureObject(value: unknown): { value: number; scale: string } {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Temperature is required');
    }
    const temperature = value as Record<string, unknown>;
    return {
        value: finiteNumber(temperature.value),
        scale: String(temperature.scale || '').toUpperCase(),
    };
}

function thermostatModeValue(value: unknown): string {
    if (typeof value === 'string') return value.toUpperCase();
    if (value && typeof value === 'object' && !Array.isArray(value)) {
        return String((value as Record<string, unknown>).value || '').toUpperCase();
    }
    throw new AlexaDirectiveError('INVALID_DIRECTIVE', 'Thermostat mode is required');
}

function maxDiscoveryEndpoints(): number {
    const configured = Number(process.env.ALEXA_MAX_ENDPOINTS || 300);
    if (!Number.isFinite(configured)) return 300;
    return Math.max(1, Math.min(300, Math.trunc(configured)));
}
