import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export declare class Refrigerator {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private refrigeratorTargetTemperature;
    private client;
    Service: typeof Service;
    Characteristic: typeof Characteristic;
    private api;
    private energyMeterValuePerHour;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string);
    getFridgeTemperature(): Promise<number>;
    setFridgeTemperature(value: CharacteristicValue): Promise<void>;
    getCurrentHeatingCoolingState(): number;
    /**
     * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
     */
    setCurrentHeatingCoolingState(): number;
    /**
     * Handle requests to set the "Target Heating Cooling State" characteristic
     */
    setTargetHeatingCoolingState(): number;
    /**
     * Handle requests to get the current value of the "Target Temperature" characteristic
     */
    getTargetTemperatureGet(): number;
    /**
     * Handle requests to get the current value of the "Temperature Display Units" characteristic
     */
    handleTemperatureDisplayUnitsGet(): number;
    /**
     * Handle requests to set the "Temperature Display Units" characteristic
     */
    handleTemperatureDisplayUnitsSet(value: CharacteristicValue): void;
    setupWebSocket(): Promise<void>;
}
