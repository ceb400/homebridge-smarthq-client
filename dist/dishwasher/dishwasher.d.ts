import { CharacteristicValue, PlatformAccessory, Service, Characteristic } from "homebridge";
import { DeviceService } from "ge-smarthq";
import { SmartHqPlatform } from "../platform.js";
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types
 */
export declare class Dishwasher {
    private readonly platform;
    private readonly accessory;
    readonly deviceServices: DeviceService[];
    readonly deviceId: string;
    private readonly groupAccessory;
    private client;
    readonly Service: typeof Service;
    readonly Characteristic: typeof Characteristic;
    private readonly api;
    private totalSeconds;
    private timeRemainingFromWebSocket;
    private energyMeterValuePerHour;
    private washZoneMap;
    private washTempMap;
    private heatedDryMap;
    private presetMap;
    private currentPreset;
    private currentWashTemp;
    private currentWashZone;
    private currentHeatedDry;
    private currentbottleWash;
    private currentSteam;
    private currentSilverwareWash;
    private readonly NORMAL_MODE;
    private readonly HEAVY_MODE;
    private readonly AUTOSENSE_MODE;
    private readonly ONE_HOUR_MODE;
    private readonly PLATPLUS_MODE;
    private readonly RINSE_MODE;
    constructor(platform: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string, groupAccessory: PlatformAccessory[]);
    /**
     * Handle requests to get the current value of the "Active" characteristic
     */
    handleSetDurationGet(): Promise<CharacteristicValue>;
    /**
     * Handle requests to get the current value of the "Active" characteristic
     */
    handleActiveGet(): Promise<CharacteristicValue>;
    /**
     * Handle requests to set the "Active" characteristic
     */
    handleActiveSet(value: CharacteristicValue): Promise<void>;
    /**
     * Handle requests to get the current value of the "In Use" characteristic
     */
    handleInUseGet(): Promise<CharacteristicValue>;
    /**
     * Handle requests to get the current value of the "Name" characteristic
     */
    handleNameGet(): Promise<string | false>;
    /**
     * Handle requests to get the current value of the "mode" value
     */
    handleModeGet(v1mode: string): Promise<CharacteristicValue>;
    /**
     * Handle requests to get the current value of the "Valve Type" characteristic
     */
    handleValveTypeGet(): Promise<number>;
    handleRemainingTimeGet(): Promise<CharacteristicValue>;
    getCyclePct(): Promise<CharacteristicValue>;
    setCyclePct(value: CharacteristicValue): Promise<CharacteristicValue>;
    setMode(): Promise<boolean | undefined>;
    startCycle(): Promise<boolean>;
    stopCycle(): Promise<boolean>;
    setupService(serviceType: string, displayName: string, serviceIdSuffix: string): Service;
    setupGroupService(serviceType: string, displayName: string, serviceIdSuffix: string, accessory: PlatformAccessory): Service;
    getAvailableItemsByType(availableType: string): [string, string][];
    getAvailablePresets(): [string, string][];
    getLastElementAndCapitalize(str: string, delimiter: string): [string, string];
    setupWebSocket(): Promise<void>;
    logCurrentOptions(): void;
}
