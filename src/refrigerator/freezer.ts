import { CharacteristicValue, PlatformAccessory, PlatformConfig, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import chalk from 'chalk';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Freezer {

  // Default temperatures for a GE Profile Refrigerator
  private freezerTargetTemperature = -17.77;    // Default 0F 

  
  private readonly smartHqApi: SmartHqApi;
  private log : Logging;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: any[],
    public readonly deviceId: string
    ) {
    this.platform = platform;
    this.accessory = accessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.log = platform.log;

    this.smartHqApi = new SmartHqApi(this.platform); 
    this.platform.debug('green', 'Adding Freezer Thermostat');
    
    //=====================================================================================
    // create a new Thermostat service for the Freezer
    //===================================================================================== 
    let displayName = "Freezer";
    const freezerThermostat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Thermostat, displayName, 'freezer-thermo1');
    freezerThermostat.setCharacteristic(this.platform.Characteristic.Name, displayName);
    freezerThermostat.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    freezerThermostat.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    const currentHeatCoolCharacteristicFreezer = freezerThermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState);
    const targetHeatCoolCharacteristicFreezer = freezerThermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState);
    const currentTempCharacteristicFreezer = freezerThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    const targetTempCharacteristicFreezer = freezerThermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature);

    //=====================================================================================
    // Now modify the properties for each characteristic to match the freezer capabilities 
    //=====================================================================================
    currentHeatCoolCharacteristicFreezer.setProps({  
      minValue: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
      maxValue: this.platform.Characteristic.CurrentHeatingCoolingState.COOL,
      validValues: [this.platform.Characteristic.CurrentHeatingCoolingState.COOL]
    });

    targetHeatCoolCharacteristicFreezer.setProps({
      minValue: this.platform.Characteristic.TargetHeatingCoolingState.OFF,
      maxValue: this.platform.Characteristic.TargetHeatingCoolingState.COOL,
      validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL]
    });

    try {
      currentTempCharacteristicFreezer.setProps({
        minValue: -21.111,          // -6F
        maxValue: -15.0,            // 5F
        minStep: 0.1
      });
    } catch (error) {
      this.platform.debug('blue', 'Error setting Freezer Current Temperature properties: ');
    }
  //=====================================================================================
  // Change properties for the characteristic for a GE Profile Refrigerator temperature range is -21.111C (-6F) to -15C (5F)
  // Values obtained from SmartHQ Api service config for refrigerator.freezer.temperature   see HB log output when debug is enabled
  //=====================================================================================
  try {
    targetTempCharacteristicFreezer.setProps({
      minValue: -21.111,          
      maxValue: -15.0,
      minStep: 0.1
    });
  } catch (error) {
    this.platform.debug('blue', 'Error setting Freezer Target Temperature properties: ');
  }

  // create handlers for required characteristics
  freezerThermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
    .onGet(this.getCurrentHeatingCoolingState.bind(this));

  freezerThermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
    .onGet(this.getCurrentHeatingCoolingState.bind(this))
    .onSet(this.setTargetHeatingCoolingState.bind(this));

  freezerThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
    .onGet(this.getFreezerTemperature.bind(this));

  freezerThermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature)
    .onGet(this.getFreezerTargetTemperature.bind(this))
    .onSet(this.setFreezerTemperature.bind(this));

  freezerThermostat.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
    .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
    .onSet(this.handleTemperatureDisplayUnitsSet.bind(this)); 

  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getFreezerTemperature().then(temp => {
      freezerThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temp);
    });
  }, 10000);       // every 10 seconds
  
}

  //=====================================================================================
  async getFreezerTemperature(): Promise<CharacteristicValue> {
    var temp = 0;
    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freezer' 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.celsiusConverted == null) {
          this.platform.debug('blue', 'No celsiusConverted returned from getFreezerTemperature state');
          return -17.77;  // Return -17.77C (0F) if no data
        }
        temp = state?.celsiusConverted;
        break;
      } 
    }
    return temp;
  }
  
  //=====================================================================================
  async setFreezerTemperature(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setTemperature");
   
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.temperature.set',
        celsius: value as number
      },
      kind:               'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType:  'cloud.smarthq.device.refrigerator.freezer',
      serviceType:        'cloud.smarthq.service.temperature',
      domainType:         'cloud.smarthq.domain.setpoint'
    };
     const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setFreezerTemperature command');
      return;
    }
  };

   /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  //=====================================================================================
  getCurrentHeatingCoolingState() {

    // set this to a valid value for CurrentHeatingCoolingState
    const currentValue = this.platform.Characteristic.CurrentHeatingCoolingState.COOL;

    return currentValue;
  }


  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  //=====================================================================================
  setCurrentHeatingCoolingState() {

    // set this to a valid value for TargetHeatingCoolingState
    const currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  //=====================================================================================
  setTargetHeatingCoolingState(value: CharacteristicValue) {
    // Nothing to do since refrigerator can only be in COOL mode
  
    const currentValue = this.platform.Characteristic.TargetHeatingCoolingState.COOL;

    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Target Temperature" characteristic
   */
  
  getFreezerTargetTemperature() {
    const currentValue = this.freezerTargetTemperature

    return currentValue;
  }

   handleTemperatureDisplayUnitsGet() {

    // set this to a valid value for TemperatureDisplayUnits
    const currentValue = this.platform.Characteristic.TemperatureDisplayUnits.CELSIUS;

    return currentValue;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  //=====================================================================================
  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
  }


}
