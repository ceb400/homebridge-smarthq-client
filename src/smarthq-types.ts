export interface DevService {
  serviceType: string;
  lastSyncTime: string;
  domainType: string;
  supportedCommands: string[];
  state: Record<string, unknown>;
  serviceId: string;
  serviceDeviceType: string;
  config: Record<string, unknown>;
  lastStateTime: string;
}

export interface DevDevice {
    deviceType: string;
    lastSyncTime: string;
    roomNumber: string;
    serial: string;
    lastPresenceTime: string;
    createdDateTime: string;
    presence: string;
    deviceId: string;
    gatewayId: string;
    room: string;
    icon: string;
    manufacturer: string;
    nickname: string;
    model: string;
    floor: string;
    macAddress: string;

}