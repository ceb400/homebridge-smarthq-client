import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export declare class WaterFilter {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private client;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string);
    getWaterFilterChangeIndication(): Promise<CharacteristicValue>;
    getWaterFilterLifeLevel(): Promise<CharacteristicValue>;
}
