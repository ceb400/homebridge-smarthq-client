import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export declare class SoundOption {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private client;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string);
    handleToggleGet(deviceType: string, domain: string): Promise<CharacteristicValue>;
    handleToggleSet(deviceType: string, domain: string, value: CharacteristicValue): Promise<void>;
    setupService(serviceType: string, displayName: string, serviceIdSuffix: string): Service;
}
