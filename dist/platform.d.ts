import { API, DynamicPlatformPlugin, PlatformConfig, PlatformAccessory, Logger } from 'homebridge';
import { Device } from 'ge-smarthq';
export declare class SmartHqPlatform implements DynamicPlatformPlugin {
    log: Logger;
    config: PlatformConfig;
    api: API;
    private client;
    readonly discoveredCacheUUIDs: string[];
    readonly accessories: Map<string, PlatformAccessory>;
    groupAccessoryArray: PlatformAccessory[];
    constructor(log: Logger, config: PlatformConfig, api: API);
    discoverDevices(): Promise<void>;
    configureAccessory(accessory: PlatformAccessory): void;
    getAccessoryByDeviceId(device: Device, uuidSuffix: string, displayName: string): PlatformAccessory | undefined;
    debug(color: string, message: string): void;
}
