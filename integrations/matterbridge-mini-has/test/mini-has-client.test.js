import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MiniHasClient,
  buildExposedDevices,
  climateSnapshot,
  contactState,
  coverSnapshot,
  dpsIdFromCode,
  matterPositionToMiniHas,
  miniHasPositionToMatter,
  powerState,
  statusFacadeContact,
} from '../src/mini-has-client.js';

const officeDevice = {
  id: 2,
  name: 'Interruptor duplo escritório',
  deviceType: 'switch',
  roomName: 'Escritório',
  status: { online: true, state: 'on', dps: { 1: true, 2: false } },
};

test('expõe todos os canais e trata a churrasqueira como luz', () => {
  const inventory = {
    devices: [
      { id: 1, name: 'Churrasqueira', status: { online: true, dps: { 1: true } } },
      officeDevice,
      { id: 5, name: 'Persiana', status: { online: true, position: 49 } },
    ],
    entities: [
      powerEntity(1, 1, 'Churrasqueira', 'switch_1'),
      powerEntity(6, 2, 'Luz principal do escritório', 'switch_1'),
      powerEntity(44, 2, 'Luz da prateleira', 'switch_2'),
      {
        id: 9,
        deviceId: 5,
        type: 'cover',
        name: 'Persiana Sala',
        commandSchema: { commands: ['open', 'close', 'stop', 'set_position'] },
        state: { online: true },
      },
    ],
  };

  const result = buildExposedDevices(inventory, { lightEntityIds: [1] });
  assert.deepEqual(result.map(({ stableId, kind, name }) => ({ stableId, kind, name })), [
    { stableId: 'mini-has-entity-1', kind: 'light', name: 'Churrasqueira' },
    { stableId: 'mini-has-entity-6', kind: 'light', name: 'Luz principal do escritório' },
    { stableId: 'mini-has-entity-9', kind: 'cover', name: 'Persiana Sala' },
    { stableId: 'mini-has-entity-44', kind: 'light', name: 'Luz da prateleira' },
  ]);
});

test('usa o DPS correto em dispositivos multicanal', () => {
  const main = powerEntity(6, 2, 'Luz principal do escritório', 'switch_1');
  const shelf = powerEntity(44, 2, 'Luz da prateleira', 'switch_2');
  assert.equal(powerState(officeDevice, main, 'switch_1'), true);
  assert.equal(powerState(officeDevice, shelf, 'switch_2'), false);
  assert.equal(dpsIdFromCode('switch_led'), '20');
});

test('mantém a semântica Matter da persiana: zero aberta e cem fechada', () => {
  assert.equal(miniHasPositionToMatter(0), 0);
  assert.equal(miniHasPositionToMatter(49), 4900);
  assert.equal(miniHasPositionToMatter(100), 10000);
  assert.equal(matterPositionToMiniHas(0), 0);
  assert.equal(matterPositionToMiniHas(5050), 51);
  assert.equal(matterPositionToMiniHas(10000), 100);
});

test('deriva posição, alvo e sentido da persiana', () => {
  assert.deepEqual(
    coverSnapshot({
      status: {
        position: 40,
        state: 'stopped',
        raw: { state: { moving: true, targetPosition: 10 } },
      },
    }, {}),
    { position: 40, targetPosition: 10, movement: 'opening' },
  );
});

test('expõe zonas de porta e janela como sensores de contato', () => {
  const inventory = {
    devices: [{ id: 15, name: 'Central', status: { online: true } }],
    entities: [{
      id: 22,
      deviceId: 15,
      type: 'binary_sensor',
      name: 'Janela Entrada',
      capabilities: { deviceClass: 'opening', readOnly: true },
      state: { online: true, state: 'open', open: true },
      commandSchema: { commands: ['query'] },
    }],
  };
  const result = buildExposedDevices(inventory);
  assert.equal(result[0].kind, 'contact');
  assert.equal(result[0].contact, false);
  assert.equal(contactState({ state: { open: false } }), true);
});

test('mapeia ar-condicionado com temperatura e modo de refrigeração', () => {
  const device = {
    status: {
      state: 'on',
      raw: {
        components: {
          main: {
            temperatureMeasurement: { temperature: { value: 25.5 } },
            thermostatCoolingSetpoint: { coolingSetpoint: { value: 22 } },
            airConditionerMode: { airConditionerMode: { value: 'cool' } },
          },
        },
      },
    },
  };
  assert.deepEqual(climateSnapshot(device), {
    on: true,
    currentTemperature: 25.5,
    targetTemperature: 22,
    mode: 'cool',
  });
});

test('mantém tipos incompatíveis visíveis sem criar comandos falsos', () => {
  const inventory = {
    devices: [
      { id: 3, name: 'Alimentador', status: { online: true, state: 'standby' } },
      { id: 14, name: 'Mainsail', status: { online: true, state: 'error' } },
    ],
    entities: [{
      id: 7,
      deviceId: 3,
      type: 'FEEDER',
      name: 'Alimentador',
      commandSchema: {
        commands: ['turn_on', 'turn_off'],
        switchCode: 'factory_reset',
      },
      state: { online: true, state: 'standby' },
    }],
  };
  const result = buildExposedDevices(inventory);
  assert.deepEqual(result.map(({ stableId, kind, contact }) => ({ stableId, kind, contact })), [
    { stableId: 'mini-has-entity-7', kind: 'status', contact: true },
    { stableId: 'mini-has-device-14-status', kind: 'status', contact: false },
  ]);
  assert.equal(statusFacadeContact({ status: { online: false } }, null), false);
});

test('envia comandos pelo dispositivo pai e pelo código da entidade', async () => {
  const calls = [];
  const client = new MiniHasClient({
    fetchImpl: async (url, options = {}) => {
      calls.push({ url, options });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });

  await client.setPower({ deviceId: 2, switchCode: 'switch_2' }, true);
  await client.setCoverPosition({ deviceId: 5 }, 62);
  await client.setClimateTarget({ deviceId: 6 }, 21.7);
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    command: 'turn_on',
    params: { code: 'switch_2' },
  });
  assert.deepEqual(JSON.parse(calls[1].options.body), {
    command: 'set_position',
    params: { position: 62 },
  });
  assert.deepEqual(JSON.parse(calls[2].options.body), {
    command: 'set',
    params: {
      commands: [{
        component: 'main',
        capability: 'thermostatCoolingSetpoint',
        command: 'setCoolingSetpoint',
        arguments: [21.5],
      }],
    },
  });
});

test('propaga falha lógica e timeout da API', async () => {
  const rejected = new MiniHasClient({
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, message: 'indisponível' })),
  });
  await assert.rejects(
    () => rejected.openCover({ deviceId: 5 }),
    /indisponível/,
  );

  const timedOut = new MiniHasClient({
    inventoryTimeoutMs: 500,
    fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }),
  });
  await assert.rejects(() => timedOut.inventory(), /Timeout/);
});

function powerEntity(id, deviceId, name, switchCode) {
  return {
    id,
    deviceId,
    type: 'switch',
    name,
    commandSchema: {
      commands: ['turn_on', 'turn_off', 'toggle'],
      switchCode,
    },
    state: { online: true },
  };
}
