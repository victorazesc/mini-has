export type JsonObject = Record<string, any>;

export type IntegrationType =
  | 'tuya_cloud'
  | 'tuya_local'
  | 'smartthings_cloud'
  | 'intelbras_izy_tuya'
  | 'persiana_custom'
  | 'generic_iot'
  | 'esphome'
  | 'onvif_camera'
  | 'mqtt';

export type IntegrationStatus = 'created' | 'connected' | 'error' | 'syncing';
export type InboxStatus = 'pending' | 'accepted' | 'ignored';
export type JobStatus = 'pending' | 'running' | 'finished' | 'failed';
export type ProbeMode = 'light' | 'balanced' | 'aggressive';

export interface CommandRequest {
  command: string;
  params?: JsonObject;
}

export interface CommandResult {
  ok: boolean;
  status: string;
  message: string;
  result: JsonObject;
}

export type DeviceEventLevel = 'info' | 'success' | 'warning' | 'error';

export interface DeviceEvent {
  id: number;
  deviceId: number;
  eventType: string;
  title: string;
  message?: string | null;
  level: DeviceEventLevel;
  payload: JsonObject;
  createdAt: string;
}

export interface DeviceHistoryEntry {
  id: string;
  kind: 'event' | 'command';
  deviceId: number;
  eventType?: string | null;
  title: string;
  message?: string | null;
  status?: string | null;
  level: DeviceEventLevel;
  command?: JsonObject | null;
  result?: JsonObject | null;
  payload?: JsonObject | null;
  createdAt: string;
}

export interface Room {
  id: number;
  name: string;
  icon?: string | null;
  floor?: string | null;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type SceneRunStatus = 'pending' | 'success' | 'partial' | 'error';

export interface SceneAction {
  id: number;
  sceneId: number;
  deviceId: number;
  deviceName?: string | null;
  deviceType?: string | null;
  orderIndex: number;
  command: string;
  params: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface SceneRun {
  id: number;
  sceneId: number;
  status: SceneRunStatus;
  summary: JsonObject;
  createdAt: string;
}

export interface Scene {
  id: number;
  name: string;
  description?: string | null;
  roomId?: number | null;
  roomName?: string | null;
  actions: SceneAction[];
  createdAt: string;
  updatedAt: string;
}

export interface Device {
  id: number;
  integrationId?: number | null;
  inboxId?: number | null;
  externalId: string;
  localDeviceKey?: string | null;
  name: string;
  deviceType: string;
  provider: string;
  roomId?: number | null;
  roomName?: string | null;
  payload: JsonObject;
  capabilities: JsonObject;
  status: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface Entity {
  id: number;
  deviceId: number;
  uniqueKey: string;
  type: string;
  name: string;
  commandSchema: JsonObject;
  state: JsonObject;
  capabilities: JsonObject;
  createdAt: string;
  updatedAt: string;
}

export interface InboxDevice {
  id: number;
  sourceType: string;
  sourceId: number;
  externalId: string;
  status: InboxStatus;
  payload: JsonObject;
  matchScore: number;
  createdAt: string;
  updatedAt: string;
}

export interface StoredIntegration {
  id: number;
  type: IntegrationType;
  name: string;
  status: IntegrationStatus;
  config: JsonObject;
  secrets: JsonObject;
  error?: string | null;
  lastSyncAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Integration = Omit<StoredIntegration, 'secrets'>;

export interface ProviderField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  default?: any;
  help?: string | null;
}

export interface ProviderDefinition {
  type: IntegrationType;
  name: string;
  description: string;
  status?: string;
  fields?: ProviderField[];
}

export interface ProviderEntity {
  key: string;
  type: string;
  name: string;
  commandSchema?: JsonObject;
  state?: JsonObject;
  capabilities?: JsonObject;
}

export interface ProviderDevice {
  externalId: string;
  name: string;
  provider: string;
  deviceType: string;
  manufacturer?: string | null;
  model?: string | null;
  ip?: string | null;
  mac?: string | null;
  productKey?: string | null;
  localDeviceKey?: string | null;
  capabilities: JsonObject;
  status: JsonObject;
  payload: JsonObject;
  secrets?: JsonObject;
  entities?: ProviderEntity[];
}

export interface DiscoveredService {
  type?: string | null;
  port?: number | null;
  name?: string | null;
  properties?: JsonObject;
}

export interface DiscoveredDevice {
  ip?: string | null;
  hostname?: string | null;
  mac?: string | null;
  name?: string | null;
  manufacturer?: string | null;
  model?: string | null;
  deviceType?: string | null;
  source: string[];
  services: DiscoveredService[];
  openPorts: number[];
  confidence: number;
  raw?: JsonObject;
}

export interface CreateDiscoveryJobRequest {
  subnet_prefix?: string;
  scan_ports?: boolean;
  timeout_seconds?: number;
  probeMode?: ProbeMode;
  ports?: number[] | null;
}

export interface DiscoveryJob {
  id: string;
  status: JobStatus;
  progress: number;
  result: DiscoveredDevice[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SavedDiscoveryScan {
  id: number;
  status: JobStatus;
  request: JsonObject;
  result: DiscoveredDevice[];
  error?: string | null;
  created_at: string;
  started_at?: string | null;
  finished_at?: string | null;
}

export interface SavedDiscoveryDevice {
  id: number;
  lastScanId?: number | null;
  firstSeenAt: string;
  lastSeenAt: string;
  device: DiscoveredDevice;
}
