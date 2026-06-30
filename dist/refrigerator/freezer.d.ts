import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export declare class Freezer {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private freezerTargetTemperature;
    private client;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string);
    getFreezerTemperature(): Promise<CharacteristicValue>;
    setFreezerTemperature(value: CharacteristicValue): Promise<void>;
    /**
    * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
    */
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
    getFreezerTargetTemperature(): number;
    handleTemperatureDisplayUnitsGet(): number;
    /**
     * Handle requests to set the "Temperature Display Units" characteristic
     */
    handleTemperatureDisplayUnitsSet(value: CharacteristicValue): void;
}
