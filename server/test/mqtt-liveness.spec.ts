import assert from 'node:assert/strict';
import test from 'node:test';
import { CommandsService } from '../src/infrastructure/commands/commands.service';
import { Device, JsonObject } from '../src/types';

test('does not treat retained MQTT state as a live device', async () => {
  const { service, waits } = commandsService([
    mqttMessage('mini-has/devices/persiana/availability', 'online', true),
    mqttMessage('mini-has/devices/persiana/cover/position', '49', true),
    mqttMessage('mini-has/devices/persiana/cover/state', 'stopped', true),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'query',
    params: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.equal(result.result.statusSummary.online, false);
  assert.equal(waits[0], 1500);
});

test('accepts a non-retained MQTT heartbeat as live status', async () => {
  const { service } = commandsService([
    mqttMessage('mini-has/devices/persiana/availability', 'online', true),
    mqttMessage('mini-has/devices/persiana/cover/position', '49', true),
    mqttMessage('mini-has/devices/persiana/cover/state', 'stopped', false),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'query',
    params: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ok');
  assert.equal(result.result.statusSummary.online, true);
  assert.equal(result.result.statusSummary.position, 49);
});

test('reports a published command as unavailable without device confirmation', async () => {
  const { service } = commandsService([
    mqttMessage('mini-has/devices/persiana/availability', 'online', true),
    mqttMessage('mini-has/devices/persiana/cover/state', 'stopped', true),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'open',
    params: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
  assert.match(result.message, /nao confirmou recebimento/);
});

test('never treats the broker echo of its own command as device confirmation', async () => {
  const { service } = commandsService([
    mqttMessage('mini-has/devices/persiana/cover/set', 'OPEN', false),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'open',
    params: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unavailable');
});

test('subscribes before publishing and confirms the expected cover state', async () => {
  const { service, publications } = commandsService([
    mqttMessage('mini-has/devices/persiana/cover/position', '49', true),
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 48.5, targetPosition: 0, moving: true, jogMode: false },
    }), false),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'open',
    params: {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'sent');
  assert.match(result.message, /estado esperado confirmado/);
  assert.deepEqual(publications, [{
    subscriptionTopic: 'mini-has/devices/persiana/#',
    topic: 'mini-has/devices/persiana/cover/set',
    payload: 'OPEN',
    retain: false,
    waitMs: 2000,
  }]);
});

test('rejects a fresh MQTT response that does not match the requested cover state', async () => {
  const { service } = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 49, targetPosition: 49, moving: false, jogMode: false },
    }), false),
  ]);

  const result = await service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'open',
    params: {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 'unconfirmed');
  assert.equal(result.result.statusSummary.online, true);
  assert.match(result.message, /nao confirmou o estado esperado/);
});

test('confirms both endpoints of the guided cover calibration', async () => {
  const open = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 0, targetPosition: 0, moving: false, normalizedEncoderTicks: 0, calibrated: false },
    }), false),
  ]);
  const closed = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 100, targetPosition: 100, moving: false, normalizedEncoderTicks: 31074, calibrated: true },
    }), false),
  ]);

  const openResult = await open.service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'calibrate_open',
    params: {},
  });
  const closedResult = await closed.service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'calibrate_closed',
    params: {},
  });

  assert.equal(openResult.ok, true);
  assert.equal(closedResult.ok, true);
  assert.deepEqual(open.publications[0].payload, { calibration: { setOpenHere: true } });
  assert.deepEqual(closed.publications[0].payload, { calibration: { setClosedHere: true } });
});

test('correlates jog confirmation with the requested movement direction', async () => {
  const opening = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 20, targetPosition: 20, moving: true, jogMode: true },
    }), false),
    mqttMessage('mini-has/devices/persiana/cover/state', 'opening', false),
  ]);
  const wrongDirection = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 20, targetPosition: 20, moving: true, jogMode: true },
    }), false),
    mqttMessage('mini-has/devices/persiana/cover/state', 'closing', false),
  ]);

  const openingResult = await opening.service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'jog_open',
    params: {},
  });
  const wrongDirectionResult = await wrongDirection.service.executeDeviceCommand(mqttDevice(), {}, {
    command: 'jog_open',
    params: {},
  });

  assert.equal(openingResult.ok, true);
  assert.equal(wrongDirectionResult.ok, false);
  assert.equal(wrongDirectionResult.status, 'unconfirmed');
});

test('prefers an explicit JSON command topic and safely derives it from cover state as fallback', async () => {
  const explicitDevice = mqttDevice();
  const explicitSchema = ((explicitDevice.payload.entities as JsonObject[])[0].commandSchema || {}) as JsonObject;
  explicitSchema.jsonCommandTopic = 'custom/persiana/calibration';
  const explicit = commandsService([
    mqttMessage('mini-has/devices/persiana/state', JSON.stringify({
      state: { position: 0, targetPosition: 0, moving: false, normalizedEncoderTicks: 0 },
    }), false),
  ]);

  const fallbackDevice = mqttDevice();
  const fallbackSchema = ((fallbackDevice.payload.entities as JsonObject[])[0].commandSchema || {}) as JsonObject;
  fallbackSchema.commandTopic = 'custom/persiana/control';
  fallbackSchema.stateTopic = 'custom/persiana/cover/state';
  fallbackSchema.positionTopic = 'custom/persiana/cover/position';
  fallbackSchema.availabilityTopic = 'custom/persiana/availability';
  const fallback = commandsService([
    mqttMessage('custom/persiana/state', JSON.stringify({
      state: { position: 0, targetPosition: 0, moving: false, normalizedEncoderTicks: 0 },
    }), false),
  ]);

  const explicitResult = await explicit.service.executeDeviceCommand(explicitDevice, {}, {
    command: 'calibrate_open',
    params: {},
  });
  const fallbackResult = await fallback.service.executeDeviceCommand(fallbackDevice, {}, {
    command: 'calibrate_open',
    params: {},
  });

  assert.equal(explicitResult.ok, true);
  assert.equal(fallbackResult.ok, true);
  assert.equal(explicit.publications[0].topic, 'custom/persiana/calibration');
  assert.equal(fallback.publications[0].topic, 'custom/persiana/command');
});

test('validates calibration maxSteps before publishing', async () => {
  const { service, publications } = commandsService([]);

  for (const maxSteps of [0, -1, Number.POSITIVE_INFINITY, 'invalid']) {
    const result = await service.executeDeviceCommand(mqttDevice(), {}, {
      command: 'calibrate_max_steps',
      params: { maxSteps },
    });
    assert.equal(result.ok, false);
    assert.match(result.message, /finito e positivo/);
  }

  assert.equal(publications.length, 0);
});

function commandsService(messages: Array<{ topic: string; payload: string; retain: boolean; qos: number }>) {
  const waits: number[] = [];
  const publications: Array<{
    subscriptionTopic: string;
    topic: string;
    payload: unknown;
    retain: boolean;
    waitMs: number;
  }> = [];
  const storage = {
    get: () => ({
      id: 13,
      type: 'mqtt',
      name: 'MQTT',
      status: 'connected',
      config_json: JSON.stringify({ brokerUrl: 'mqtt://192.168.1.57:1883' }),
      secrets_json: '{}',
      error: null,
      last_sync_at: null,
      created_at: '2026-01-01T00:00:00.000Z',
      updated_at: '2026-01-01T00:00:00.000Z',
    }),
    jsonLoad: (value: unknown, fallback: JsonObject) => {
      if (typeof value !== 'string') return fallback;
      try {
        return JSON.parse(value);
      } catch {
        return fallback;
      }
    },
  };
  const providers = {
    collectMqttMessages: async (_integration: unknown, _topic: string, waitMs: number) => {
      waits.push(waitMs);
      return messages;
    },
    publishMqttCommand: async (_integration: unknown, topic: string, payload: unknown, retain: boolean) => ({
      topic,
      payload,
      retain,
    }),
    publishMqttCommandAndCollect: async (
      _integration: unknown,
      subscriptionTopic: string,
      topic: string,
      payload: unknown,
      retain: boolean,
      waitMs: number,
    ) => {
      publications.push({ subscriptionTopic, topic, payload, retain, waitMs });
      return { topic, payload, retain, messages };
    },
  };

  return {
    service: new CommandsService(storage as never, providers as never, {} as never),
    waits,
    publications,
  };
}

function mqttDevice(): Device {
  return {
    id: 5,
    integrationId: 13,
    externalId: 'persiana',
    name: 'Persiana',
    deviceType: 'cover',
    provider: 'mqtt',
    payload: {
      entities: [{
        key: 'persiana',
        commandSchema: {
          commandTopic: 'mini-has/devices/persiana/cover/set',
          stateTopic: 'mini-has/devices/persiana/cover/state',
          positionTopic: 'mini-has/devices/persiana/cover/position',
          setPositionTopic: 'mini-has/devices/persiana/cover/position/set',
          availabilityTopic: 'mini-has/devices/persiana/availability',
          payloadOpen: 'OPEN',
          payloadClose: 'CLOSE',
          payloadStop: 'STOP',
        },
      }],
    },
    capabilities: {},
    status: {},
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

function mqttMessage(topic: string, payload: string, retain: boolean) {
  return { topic, payload, retain, qos: 0 };
}
