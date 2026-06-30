import { PlatformAccessory } from 'homebridge';
import { SmartHqPlatform } from './platform.js';
import { DeviceService } from 'ge-smarthq';
export declare function setupDishwasherServices(this: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string, groupAccessory?: PlatformAccessory[]): void;
