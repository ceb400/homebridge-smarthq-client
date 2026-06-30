import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * These switches can be used with Pushover switches in Homekit automations to send notifications to your iOS devices
 */
export declare class RefrigeratorAlerts {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private alertDoorState;
    private alertLeakState;
    private alertFilterState;
    private alertTemperatureState;
    private alertUpdateState;
    private client;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string);
    setupWebSocket(): Promise<void>;
    getAlertDoorOn(): Promise<CharacteristicValue>;
    getAlertTemperatureOn(): Promise<CharacteristicValue>;
    getAlertFilterOn(): Promise<CharacteristicValue>;
    getAlertUpdateOn(): Promise<CharacteristicValue>;
    getAlertLeakOn(): Promise<CharacteristicValue>;
    /**
     * Handle requests to set the "On" characteristic
     */
    setAlertDoorOn(value: CharacteristicValue): void;
    setAlertTemperatureOn(value: CharacteristicValue): void;
    setAlertFilterOn(value: CharacteristicValue): void;
    setAlertUpdateOn(value: CharacteristicValue): void;
    setAlertLeakOn(value: CharacteristicValue): void;
}
