import {
  MatterbridgeDynamicPlatform,
  MatterbridgeEndpoint,
  contactSensor,
  onOffLight,
  onOffPlugInUnit,
  roomAirConditioner,
  windowCovering,
} from 'matterbridge';
import {
  BooleanState,
  BridgedDeviceBasicInformation,
  OnOff,
  Thermostat,
  WindowCovering,
} from 'matterbridge/matter/clusters';
import {
  MiniHasClient,
  buildExposedDevices,
  matterPositionToMiniHas,
  miniHasPositionToMatter,
} from './mini-has-client.js';

export default function initializePlugin(matterbridge, log, config) {
  return new MiniHasMatterPlatform(matterbridge, log, config);
}

export class MiniHasMatterPlatform extends MatterbridgeDynamicPlatform {
  constructor(matterbridge, log, config) {
    super(matterbridge, log, config);
    if (typeof this.verifyMatterbridgeVersion !== 'function' || !this.verifyMatterbridgeVersion('3.10.0')) {
      throw new Error('O plugin Mini-HAS requer Matterbridge 3.10.0 ou superior.');
    }

    this.client = new MiniHasClient({
      baseUrl: process.env.MINI_HAS_API_BASE_URL || config.baseUrl,
      inventoryTimeoutMs: config.inventoryTimeoutMs,
      commandTimeoutMs: config.commandTimeoutMs,
    });
    this.endpoints = new Map();
    this.commandsInFlight = new Set();
    this.pollTimer = null;
    this.reconciling = false;
    this.stopping = false;
  }

  async onStart(reason) {
    this.log.info(`Iniciando ponte Mini-HAS (${reason || 'inicialização'}).`);
    await this.ready;
    await this.clearSelect();
    await this.reconcileInventory(true);

    const seconds = Math.max(2, Math.min(60, Number(this.config.pollIntervalSeconds || 3)));
    this.pollTimer = setInterval(() => void this.reconcileInventory(false), seconds * 1000);
    this.pollTimer.unref?.();
  }

  async onConfigure() {
    await super.onConfigure();
    await this.reconcileInventory(false);
  }

  async onShutdown(reason) {
    this.stopping = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    this.client.close();
    await super.onShutdown(reason);
    if (this.config.unregisterOnShutdown) await this.unregisterAllDevices();
    this.log.info(`Ponte Mini-HAS encerrada (${reason || 'sem motivo informado'}).`);
  }

  async reconcileInventory(required) {
    if (this.reconciling || this.stopping) return;
    this.reconciling = true;
    try {
      const inventory = await this.client.inventory();
      const descriptors = buildExposedDevices(inventory, this.config);
      for (const descriptor of descriptors) {
        await this.registerOrUpdate(descriptor);
      }
      this.log.debug(`Inventário sincronizado: ${descriptors.length} dispositivos Matter.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.error(`Falha ao sincronizar o Mini-HAS: ${message}`);
      if (required) throw error;
    } finally {
      this.reconciling = false;
    }
  }

  async registerOrUpdate(descriptor) {
    const existing = this.endpoints.get(descriptor.stableId);
    if (existing) {
      const changed = descriptorStateChanged(existing.descriptor, descriptor);
      existing.descriptor = descriptor;
      if (changed && !this.commandsInFlight.has(descriptor.stableId)) {
        await this.updateEndpoint(existing.endpoint, descriptor);
      }
      return;
    }

    this.setSelectDevice(descriptor.serial, descriptor.name);
    if (!this.validateDevice([descriptor.name, descriptor.serial])) return;

    const endpoint = descriptor.kind === 'cover'
      ? this.createCoverEndpoint(descriptor)
      : descriptor.kind === 'contact' || descriptor.kind === 'status'
        ? this.createContactEndpoint(descriptor)
        : descriptor.kind === 'climate'
          ? this.createClimateEndpoint(descriptor)
        : this.createPowerEndpoint(descriptor);
    await this.registerDevice(endpoint);
    await endpoint.updateAttribute(BridgedDeviceBasicInformation, 'reachable', descriptor.online);
    this.endpoints.set(descriptor.stableId, { endpoint, descriptor });
    this.log.info(`Dispositivo exposto: ${descriptor.name} (${descriptor.kind}).`);
  }

  createPowerEndpoint(descriptor) {
    const deviceType = descriptor.kind === 'light' ? onOffLight : onOffPlugInUnit;
    const productName = descriptor.kind === 'light' ? 'Mini-HAS Light' : 'Mini-HAS Outlet';
    return new MatterbridgeEndpoint(deviceType, { id: descriptor.stableId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        descriptor.name,
        descriptor.serial,
        this.matterbridge.aggregatorVendorId,
        'Mini-HAS',
        productName,
        1,
        '1.0.0',
      )
      .createDefaultOnOffClusterServer(descriptor.on)
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters()
      .addCommandHandler('OnOff.on', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.setPower(this.currentDescriptor(descriptor.stableId), true);
      }))
      .addCommandHandler('OnOff.off', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.setPower(this.currentDescriptor(descriptor.stableId), false);
      }))
      .addCommandHandler('OnOff.toggle', ({ attributes }) => this.runCommand(descriptor.stableId, async () => {
        await this.client.setPower(this.currentDescriptor(descriptor.stableId), !attributes.onOff);
      }));
  }

  createCoverEndpoint(descriptor) {
    return new MatterbridgeEndpoint(windowCovering, { id: descriptor.stableId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        descriptor.name,
        descriptor.serial,
        this.matterbridge.aggregatorVendorId,
        'Mini-HAS',
        'Mini-HAS Cover',
        1,
        '1.0.0',
      )
      .createDefaultWindowCoveringClusterServer(miniHasPositionToMatter(descriptor.position))
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters()
      .addCommandHandler('WindowCovering.upOrOpen', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.openCover(this.currentDescriptor(descriptor.stableId));
      }))
      .addCommandHandler('WindowCovering.downOrClose', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.closeCover(this.currentDescriptor(descriptor.stableId));
      }))
      .addCommandHandler('WindowCovering.stopMotion', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.stopCover(this.currentDescriptor(descriptor.stableId));
      }))
      .addCommandHandler('WindowCovering.goToLiftPercentage', ({ request }) => this.runCommand(descriptor.stableId, async () => {
        await this.client.setCoverPosition(
          this.currentDescriptor(descriptor.stableId),
          matterPositionToMiniHas(request.liftPercent100thsValue),
        );
      }));
  }

  createContactEndpoint(descriptor) {
    return new MatterbridgeEndpoint(contactSensor, { id: descriptor.stableId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        descriptor.name,
        descriptor.serial,
        this.matterbridge.aggregatorVendorId,
        'Mini-HAS',
        descriptor.kind === 'status' ? 'Mini-HAS Status Sensor' : 'Mini-HAS Contact Sensor',
        1,
        '1.0.0',
      )
      .createDefaultBooleanStateClusterServer(descriptor.contact)
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters();
  }

  createClimateEndpoint(descriptor) {
    const endpoint = new MatterbridgeEndpoint(roomAirConditioner, { id: descriptor.stableId })
      .createDefaultBridgedDeviceBasicInformationClusterServer(
        descriptor.name,
        descriptor.serial,
        this.matterbridge.aggregatorVendorId,
        'Mini-HAS',
        'Mini-HAS Air Conditioner',
        1,
        '1.0.0',
      )
      .createDeadFrontOnOffClusterServer(descriptor.on)
      .createDefaultCoolingThermostatClusterServer(
        descriptor.currentTemperature,
        descriptor.targetTemperature,
        16,
        30,
      )
      .createDefaultPowerSourceWiredClusterServer()
      .addRequiredClusters()
      .addCommandHandler('OnOff.on', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.setClimatePower(this.currentDescriptor(descriptor.stableId), true);
      }))
      .addCommandHandler('OnOff.off', () => this.runCommand(descriptor.stableId, async () => {
        await this.client.setClimatePower(this.currentDescriptor(descriptor.stableId), false);
      }));

    endpoint.subscribeAttribute(Thermostat, 'occupiedCoolingSetpoint', (newValue, oldValue, context) => {
      if (context.fabric === undefined || this.commandsInFlight.has(descriptor.stableId)) return;
      void this.runCommand(descriptor.stableId, async () => {
        await this.client.setClimateTarget(this.currentDescriptor(descriptor.stableId), Number(newValue) / 100);
      }).catch((error) => {
        this.log.error(`Falha ao ajustar ${descriptor.name}: ${error instanceof Error ? error.message : String(error)}`);
        void endpoint.updateAttribute(Thermostat, 'occupiedCoolingSetpoint', oldValue);
      });
    });
    return endpoint;
  }

  async updateEndpoint(endpoint, descriptor) {
    await endpoint.updateAttribute(BridgedDeviceBasicInformation, 'reachable', descriptor.online);
    if (descriptor.kind === 'contact' || descriptor.kind === 'status') {
      await endpoint.updateAttribute(BooleanState, 'stateValue', descriptor.contact);
      return;
    }
    if (descriptor.kind === 'climate') {
      await endpoint.updateAttribute(OnOff, 'onOff', descriptor.on);
      await endpoint.updateAttribute(Thermostat, 'localTemperature', Math.round(descriptor.currentTemperature * 100));
      await endpoint.updateAttribute(Thermostat, 'occupiedCoolingSetpoint', Math.round(descriptor.targetTemperature * 100));
      await endpoint.updateAttribute(
        Thermostat,
        'systemMode',
        descriptor.on ? Thermostat.SystemMode.Cool : Thermostat.SystemMode.Off,
      );
      return;
    }
    if (descriptor.kind !== 'cover') {
      await endpoint.updateAttribute(OnOff, 'onOff', descriptor.on);
      return;
    }

    const movement = descriptor.movement === 'opening'
      ? WindowCovering.MovementStatus.Opening
      : descriptor.movement === 'closing'
        ? WindowCovering.MovementStatus.Closing
        : WindowCovering.MovementStatus.Stopped;
    await endpoint.setWindowCoveringCurrentTargetStatus(
      miniHasPositionToMatter(descriptor.position),
      miniHasPositionToMatter(descriptor.targetPosition),
      movement,
    );
  }

  currentDescriptor(stableId) {
    const entry = this.endpoints.get(stableId);
    if (!entry) throw new Error(`Dispositivo Mini-HAS não encontrado: ${stableId}`);
    return entry.descriptor;
  }

  async runCommand(stableId, command) {
    this.commandsInFlight.add(stableId);
    try {
      await command();
    } finally {
      this.commandsInFlight.delete(stableId);
    }
  }
}

function descriptorStateChanged(previous, current) {
  if (!previous || previous.kind !== current.kind || previous.online !== current.online) return true;
  if (current.kind === 'contact' || current.kind === 'status') return previous.contact !== current.contact;
  if (current.kind === 'cover') {
    return previous.position !== current.position
      || previous.targetPosition !== current.targetPosition
      || previous.movement !== current.movement;
  }
  if (current.kind === 'climate') {
    return previous.on !== current.on
      || previous.currentTemperature !== current.currentTemperature
      || previous.targetTemperature !== current.targetTemperature
      || previous.mode !== current.mode;
  }
  return previous.on !== current.on;
}
