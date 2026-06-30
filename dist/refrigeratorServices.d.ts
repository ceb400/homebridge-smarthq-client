import { PlatformAccessory } from 'homebridge';
import { SmartHqPlatform } from './platform.js';
import { DeviceService } from 'ge-smarthq';
export declare function setupRefrigeratorServices(this: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string): void;
