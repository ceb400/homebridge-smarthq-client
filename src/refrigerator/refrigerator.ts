import { CharacteristicValue, PlatformAccessory, PlatformConfig, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Refrigerator {
  // Default temperatures for a GE Profile Refrigerator
  private refrigeratorTargetTemperature = 2.78; // Default 37F in Celsius

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

    this.platform.debug('green', 'Adding Refrigerator Thermostat');
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');
    
    //=====================================================================================
    // create a new Thermostat service for the Refrigerator
    //===================================================================================== 
    let displayName = "Refrigerator";
    const refrigeratorThermostat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Thermostat, displayName, 'fridge-thermo1');
    // set the service name, this is what is displayed as the default name on the Home app
    refrigeratorThermostat.setCharacteristic(this.platform.Characteristic.Name, displayName);
    refrigeratorThermostat.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    refrigeratorThermostat.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    const currentHeatCoolCharacteristic = refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState);
    const targetHeatCoolCharacteristic = refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState);
    const currentTempCharacteristic = refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature);
    const targetTempCharacteristic = refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature);

    // Now modify the properties for each characteristic to match the refrigerator capabilities 
    // Only allow COOL mode for refrigerator  
    currentHeatCoolCharacteristic.setProps({  
      minValue: this.platform.Characteristic.CurrentHeatingCoolingState.OFF,
      maxValue: this.platform.Characteristic.CurrentHeatingCoolingState.COOL,
      validValues: [this.platform.Characteristic.CurrentHeatingCoolingState.COOL]
    });

    // Only allow COOL mode for refrigerator
    targetHeatCoolCharacteristic.setProps({
      minValue: this.platform.Characteristic.TargetHeatingCoolingState.OFF,
      maxValue: this.platform.Characteristic.TargetHeatingCoolingState.COOL,
      validValues: [this.platform.Characteristic.TargetHeatingCoolingState.COOL]
    });

    try {
      currentTempCharacteristic.setProps({
        minValue: 0,
        maxValue: 8.0,
        minStep: 0.1
      });
    } catch (error) {
      this.platform.debug('blue', 'Error setting Refrigerator Current Temperature properties: ');
    }
      
      // Change properties for the characteristic for a GE Profile Refrigerator temperature range is 1.111C (34F) to 5.556C (42F)
      // Values obtained from SmartHQ Api service config for refrigerator.freshfood.temperature   see HB log output when debug is enabled
    try {
      targetTempCharacteristic.setProps({
        minValue: 1.111,          
        maxValue: 5.556,
        minStep: 0.1
      });
    } catch (error) {
      this.platform.debug('blue', 'Error setting Refrigerator Target Temperature properties: ');
    }

    // create handlers for required characteristics
    refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));
    // Only allow COOL mode for refrigerator
    refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.TargetHeatingCoolingState)
      .onGet(this.setTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getFridgeTemperature.bind(this));

    refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.TargetTemperature)
      .onGet(this.getFridgeTemperature.bind(this))
      .onSet(this.setFridgeTemperature.bind(this));

    refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getFridgeTemperature().then(temp => {
      refrigeratorThermostat.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temp);
    });
  }, 5000);
  
}

  //=====================================================================================
  // Refrigerator Temperature Handlers using SmartHQ API commands in smartHqApi.ts
  //=====================================================================================
  async getFridgeTemperature(): Promise<CharacteristicValue> {
    var temp = 0;
    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freshfood' 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.celsiusConverted == null) {
          this.platform.debug('blue', 'No state.celsiusConverted returned from getFridgeTemperature state');
          return 2.78;  // Return 2.78C (37F) if no data
        }
        temp = state?.celsiusConverted;
        break;
      } 
    }

    // if you need to return an error to show the device as "Not Responding" in the Home app:
    // throw new this.platform.api.hap.HapStatusError(this.platform.api.hap.HAPStatus.SERVICE_COMMUNICATION_FAILURE);

    return temp;

  }

  
  //=====================================================================================
  async setFridgeTemperature(value: CharacteristicValue) {
    if (this.platform.config.debug) {
      this.log.info("Triggered setTemperature");
    }
    this.refrigeratorTargetTemperature = value as number;

    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.temperature.set',
        celsius: value as number
      },
      kind:               'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType:  'cloud.smarthq.device.refrigerator.freshfood',
      serviceType:        'cloud.smarthq.service.temperature',
      domainType:         'cloud.smarthq.domain.setpoint'
    };
    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setFridgeTemperature command');
      return;
    }
  };

  
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
  //=====================================================================================
  getTargetTemperatureGet() {
    const currentValue = this.refrigeratorTargetTemperature

    return currentValue;
  }

  /**
   * Handle requests to get the current value of the "Temperature Display Units" characteristic
   */
  //=====================================================================================
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
