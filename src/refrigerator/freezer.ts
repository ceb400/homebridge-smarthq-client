import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Freezer {
  // Default temperatures for a GE Profile Refrigerator
  private freezerTargetTemperature = -17.77;    // Default 0F
  private client: SmartHQClient;
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  private readonly api: API;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: DeviceService[],
    public readonly deviceId: string,
    ) {

    this.api = platform.api; 
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.accessory = accessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.platform = platform;
    this.client = new SmartHQClient({
      clientId:       platform.config.clientId,
      clientSecret:   platform.config.clientSecret,
      redirectUri:    platform.config.redirectUri,
      debug:          platform.config.debugLogging || false,
    });

    this.client.debug('Adding Freezer Thermostat');
    
    //=====================================================================================
    // create a new Thermostat service for the Freezer
    //===================================================================================== 
    const displayName = "Freezer";
    const freezerThermostat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Thermostat, displayName, 'freezer-thermo1');
    freezerThermostat.setCharacteristic(this.Characteristic.Name, displayName);
    freezerThermostat.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    freezerThermostat.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    const currentHeatCoolCharacteristicFreezer = freezerThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState);
    const targetHeatCoolCharacteristicFreezer = freezerThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState);
    const currentTempCharacteristicFreezer = freezerThermostat.getCharacteristic(this.Characteristic.CurrentTemperature);
    const targetTempCharacteristicFreezer = freezerThermostat.getCharacteristic(this.Characteristic.TargetTemperature);

    //=====================================================================================
    // Now modify the properties for each characteristic to match the freezer capabilities 
    //=====================================================================================
    currentHeatCoolCharacteristicFreezer.setProps({  
      minValue: this.Characteristic.CurrentHeatingCoolingState.OFF,
      maxValue: this.Characteristic.CurrentHeatingCoolingState.COOL,
      validValues: [this.Characteristic.CurrentHeatingCoolingState.COOL]
    });

    targetHeatCoolCharacteristicFreezer.setProps({
      minValue: this.Characteristic.TargetHeatingCoolingState.OFF,
      maxValue: this.Characteristic.TargetHeatingCoolingState.COOL,
      validValues: [this.Characteristic.TargetHeatingCoolingState.COOL]
    });

    try {
      currentTempCharacteristicFreezer.setProps({
        minValue: -21.111,          // -6F
        maxValue: -15.0,            // 5F
        minStep: 0.1
      });
    } catch (error) {
      this.client.debug('Error setting Freezer Current Temperature properties: ' + error);
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
    this.client.debug('Error setting Freezer Target Temperature properties: ' + error);
  }

  // create handlers for required characteristics
  freezerThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
    .onGet(this.getCurrentHeatingCoolingState.bind(this));

  freezerThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
    .onGet(this.getCurrentHeatingCoolingState.bind(this))
    .onSet(this.setTargetHeatingCoolingState.bind(this));

  freezerThermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
    .onGet(this.getFreezerTemperature.bind(this));

  freezerThermostat.getCharacteristic(this.Characteristic.TargetTemperature)
    .onGet(this.getFreezerTargetTemperature.bind(this))
    .onSet(this.setFreezerTemperature.bind(this));

  freezerThermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
    .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
    .onSet(this.handleTemperatureDisplayUnitsSet.bind(this)); 

  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getFreezerTemperature().then(temp => {
      freezerThermostat.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temp);
    });
  }, 10000);       // every 10 seconds
  
}

  //=====================================================================================
  async getFreezerTemperature(): Promise<CharacteristicValue> {
    let temp = 0;
    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freezer' 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response?.state?.celsiusConverted == null) {
            this.client.debug('No celsiusConverted returned from getFreezerTemperature state');
            return -17.77;  // Return -17.77C (0F) if no data
          }
          temp = Number(response?.state?.celsiusConverted);
          break;
        } catch (error) {
            this.client.debug(`error response from getFreezerTemperature: ${error}`);
          return -17.77;  // Return -17.77C (0F) on error
        }
      }
    }
    return temp;
  }
  
  //=====================================================================================
  async setFreezerTemperature(value: CharacteristicValue) {
   
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
    try { 
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setFreezerTemperature command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setFreezerTemperature command: ' + error);
    }
  };

   /**
   * Handle requests to get the current value of the "Current Heating Cooling State" characteristic
   */
  //=====================================================================================
  getCurrentHeatingCoolingState() {

    // set this to a valid value for CurrentHeatingCoolingState
    const currentValue = this.Characteristic.CurrentHeatingCoolingState.COOL;

    return currentValue;
  }


  /**
   * Handle requests to get the current value of the "Target Heating Cooling State" characteristic
   */
  //=====================================================================================
  setCurrentHeatingCoolingState() {

    // set this to a valid value for TargetHeatingCoolingState
    const currentValue = this.Characteristic.TargetHeatingCoolingState.COOL;

    return currentValue;
  }

  /**
   * Handle requests to set the "Target Heating Cooling State" characteristic
   */
  //=====================================================================================
  setTargetHeatingCoolingState() {
    // Nothing to do since refrigerator can only be in COOL mode
  
    const currentValue = this.Characteristic.TargetHeatingCoolingState.COOL;
    
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
    const currentValue = this.Characteristic.TemperatureDisplayUnits.CELSIUS;

    return currentValue;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  //=====================================================================================
  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.client.debug('handleTemperatureDisplayUnitsSet value: ' + value);
  }


}
