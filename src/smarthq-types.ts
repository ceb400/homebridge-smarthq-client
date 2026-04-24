export interface DevService {
  serviceId: string;
  serviceType: string;
  domainType: string;
  serviceDeviceType: string;
  supportedCommands: string[];
  state?: Record<string, unknown>;
  config?: Record<string, unknown>;
  lastStateTime?: string;
  lastSyncTime?: string;
}

export interface DevDevice {
    deviceId: string;
    deviceType: string;
    lastSyncTime: string;
    roomNumber: string;
    serial: string;
    lastPresenceTime: string;
    createdDateTime: string;
    presence: string;
    gatewayId: string;
    room: string;
    icon: string;
    manufacturer: string;
    nickname: string;
    model: string;
    floor: string;
    macAddress: string;
}

