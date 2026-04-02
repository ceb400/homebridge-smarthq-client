import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js'

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class Refrigerator {
  // Default temperatures for a GE Profile Refrigerator
  private refrigeratorTargetTemperature = 2.78; // Default 37F in Celsius

  private client: SmartHQClient;
  public  Service: typeof Service;
  public  Characteristic: typeof Characteristic;
  private  api: API;

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
    this.client = new SmartHQClient({
      clientId:       platform.config.clientId,
      clientSecret:   platform.config.clientSecret,
      redirectUri:    platform.config.redirectUri,
      debug:          platform.config.debugLogging || false,
    });
    
    this.client.debug('Adding Refrigerator Thermostat');
    
    // set accessory information
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    const alerts =  this.client.getDeviceAlerts(deviceId);
    if (alerts) {
      this.client.debug('Refrigerator Alerts: ' + JSON.stringify(alerts, null, 2));
    } else {
      this.client.debug('No alerts returned from getDeviceAlerts for refrigerator');
    }
    
    //=====================================================================================
    // create a new Thermostat service for the Refrigerator
    //===================================================================================== 
    const displayName = "Refrigerator";
    const refrigeratorThermostat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Thermostat, displayName, 'fridge-thermo1');
    // set the service name, this is what is displayed as the default name on the Home app
    refrigeratorThermostat.setCharacteristic(this.Characteristic.Name, displayName);
    refrigeratorThermostat.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    refrigeratorThermostat.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    const currentHeatCoolCharacteristic = refrigeratorThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState);
    const targetHeatCoolCharacteristic = refrigeratorThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState);
    const currentTempCharacteristic = refrigeratorThermostat.getCharacteristic(this.Characteristic.CurrentTemperature);
    const targetTempCharacteristic = refrigeratorThermostat.getCharacteristic(this.Characteristic.TargetTemperature);

    // Now modify the properties for each characteristic to match the refrigerator capabilities 
    // Only allow COOL mode for refrigerator  
    currentHeatCoolCharacteristic.setProps({  
      minValue: this.Characteristic.CurrentHeatingCoolingState.OFF,
      maxValue: this.Characteristic.CurrentHeatingCoolingState.COOL,
      validValues: [this.Characteristic.CurrentHeatingCoolingState.COOL]
    });

    // Only allow COOL mode for refrigerator
    targetHeatCoolCharacteristic.setProps({
      minValue: this.Characteristic.TargetHeatingCoolingState.OFF,
      maxValue: this.Characteristic.TargetHeatingCoolingState.COOL,
      validValues: [this.Characteristic.TargetHeatingCoolingState.COOL]
    });

    try {
      currentTempCharacteristic.setProps({
        minValue: 0,
        maxValue: 8.0,
        minStep: 0.1
      });
    } catch (error) {
      this.client.debug('Error setting Refrigerator Current Temperature properties: ' + error);
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
      this.client.debug('Error setting Refrigerator Target Temperature properties: ' + error);
    }

    // create handlers for required characteristics
    refrigeratorThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));
    // Only allow COOL mode for refrigerator
    refrigeratorThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.setTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    refrigeratorThermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(this.getFridgeTemperature.bind(this));

    refrigeratorThermostat.getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(this.getFridgeTemperature.bind(this))
      .onSet(this.setFridgeTemperature.bind(this));

    refrigeratorThermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getFridgeTemperature().then(temp => {
      refrigeratorThermostat.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temp);
    });
  }, 30000);
  
}

  //=====================================================================================
  // Refrigerator Temperature Handlers using SmartHQ API commands in smartHqApi.ts
  //=====================================================================================
  async getFridgeTemperature(): Promise<number> {
    let temp = 0;
    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freshfood' 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response?.state?.celsiusConverted == null) {
            this.client.debug('No state.celsiusConverted returned from getFridgeTemperature state');
            temp = 2.78;  // Return 2.78C (37F) if no data

            return temp;
          }
          temp = Number(response.state.celsiusConverted);
          break; 
        }  catch (error) {
          this.client.debug('Error getting Refrigerator Temperature: ' + error);
          return 2.78;  // Return 2.78C (37F) on error
        } 
      }
    }
    return temp;
  }

  
  //=====================================================================================
  async setFridgeTemperature(value: CharacteristicValue) {
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

    try {
        const response = await this.client.sendCommand(cmdBody);

        if (response == null) {
          this.client.debug('No response from setFridgeTemperature command');
          return;
        }
      } catch (error) {
        this.client.debug('Error sending setFridgeTemperature command: ' + error);
        return;
       }
  }

  
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
    const currentValue = this.Characteristic.TemperatureDisplayUnits.CELSIUS;

    return currentValue;
  }

  /**
   * Handle requests to set the "Temperature Display Units" characteristic
   */
  //=====================================================================================
  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    if (value === this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT) {
      this.client.debug('Temperature Display Units set to FAHRENHEIT');
    }
  }
}
