import assert from 'node:assert/strict';
import test from 'node:test';
import { Device } from '../src/types';
import {
  alexaBrightness,
  brightnessCommand,
  climateCurrentCelsius,
  climateMode,
  climateTargetCelsius,
  deviceStateProperties,
  deviceToAlexaEndpoint,
  miniHasToAlexaOpening,
} from '../src/modules/alexa/alexa.mapper';

test('maps a cover position to Alexa opening semantics', () => {
  assert.equal(miniHasToAlexaOpening(0), 100);
  assert.equal(miniHasToAlexaOpening(100), 0);
});

test('maps Tuya brightness without exposing provider details', () => {
  const light = device({
    deviceType: 'light',
    capabilities: {
      status: [{ code: 'bright_value_v2', value: 300 }],
    },
    status: { state: 'on', dps: { bright_value_v2: 300 } },
  });

  assert.equal(alexaBrightness(light), 30);
  assert.deepEqual(brightnessCommand(light, 50), {
    code: 'bright_value_v2',
    value: 500,
  });
  const endpoint = deviceToAlexaEndpoint(light);
  assert.equal(
    (endpoint.capabilities as Array<Record<string, unknown>>)
      .some((capability) => capability.interface === 'Alexa.BrightnessController'),
    true,
  );
});

test('maps SmartThings climate state and capabilities', () => {
  const climate = device({
    deviceType: 'climate',
    provider: 'smartthings_cloud',
    status: {
      state: 'on',
      raw: {
        components: {
          main: {
            airConditionerMode: { airConditionerMode: { value: 'cool' } },
            thermostatCoolingSetpoint: { coolingSetpoint: { value: 22 } },
            temperatureMeasurement: { temperature: { value: 23 } },
          },
        },
      },
    },
  });

  assert.equal(climateMode(climate), 'COOL');
  assert.equal(climateTargetCelsius(climate), 22);
  assert.equal(climateCurrentCelsius(climate), 23);

  const endpoint = deviceToAlexaEndpoint(climate);
  const interfaces = (endpoint.capabilities as Array<Record<string, unknown>>)
    .map((capability) => capability.interface);
  assert.ok(interfaces.includes('Alexa.PowerController'));
  assert.ok(interfaces.includes('Alexa.ThermostatController'));
  assert.ok(interfaces.includes('Alexa.TemperatureSensor'));

  const properties = deviceStateProperties(climate);
  assert.ok(properties.some((property) => property.name === 'targetSetpoint'));
  assert.ok(properties.some((property) => property.name === 'temperature'));
});

function device(overrides: Partial<Device>): Device {
  return {
    id: 1,
    externalId: 'test',
    name: 'Teste',
    deviceType: 'switch',
    provider: 'test',
    payload: {},
    capabilities: {},
    status: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}
