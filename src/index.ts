import type { API } from 'homebridge';

import { SmartHqPlatform } from './platform.js';
import { PLATFORM_NAME } from './settings.js';

/**
 * This method registers the platform with Homebridge
 */
export default (api: API) => {
  api.registerPlatform(PLATFORM_NAME, SmartHqPlatform);
};
/**
 * OAuth2 credentials
 */
export interface SmartHQCredentials {
  access_token: string
  token_type: string
  expires_in: number
  refresh_token?: string
  expires?: number
}
export interface WebSocketMessage {
  kind: string
  action?: string
  id?: string
  success?: boolean
  [key: string]: unknown
}

export interface ServiceMessage extends WebSocketMessage {
  kind: 'pubsub#service'
  deviceId: string
  userId: string
  adapterId: string
  serviceId: string
  serviceType: string
  domainType: string
  serviceDeviceType: string
  deviceType: string
  lastSyncTime: string
  lastStateTime: string
  state?: Record<string, unknown>
  config?: Record<string, unknown>
}

export interface DeviceMessage extends WebSocketMessage {
  kind: 'pubsub#device'
  deviceId: string
  userId: string
  adapterId: string
  deviceType: string
  event: string
  lastSyncTime: string
  services?: Record<string, unknown>[]
  gatewayId?: string
}

export interface AlertMessage extends WebSocketMessage {
  kind: 'pubsub#alert'
  deviceId: string
  userId: string
  adapterId: string
  deviceType: string
  alertType: string
  lastAlertTime: string
  services?: Record<string, unknown>[]
}

export interface PresenceMessage extends WebSocketMessage {
  kind: 'pubsub#presence'
  deviceId: string
  userId: string
  adapterId: string
  deviceType: string
  lastSyncTime: string
  presence?: {
    online?: boolean
    status?: string
  }
}

export interface CommandMessage extends WebSocketMessage {
  kind: 'pubsub#command'
  deviceId: string
  serviceId: string
  commandType: string
  outcome?: string
  correlationId?: string
}


export interface PubsubConfig {
  kind: 'websocket#pubsub' | 'user#pubsub'
  action: 'pubsub'
  pubsub?: boolean
  alerts?: boolean
  services?: boolean
  presence?: boolean
  commands?: boolean
  deviceId?: string
}
