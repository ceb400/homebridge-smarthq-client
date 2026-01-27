import { CharacteristicValue, PlatformAccessory, PlatformConfig, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TemperatureUnits {

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

    //=====================================================================================
    // Check to see if the device has any supported Temperature Units services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.refrigerator',
          'cloud.smarthq.service.mode',
          'cloud.smarthq.domain.temperatureunits')) {
      this.log.info('No supported Temperature Units service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Temperature Units Switches');

    //=====================================================================================
    // create Temperature Unit switches for the Refrigerator 
    //=====================================================================================
    let displayName = "Units: Celsius"; 

    const unitsCelsius = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'units-celsius-123');
    unitsCelsius.setCharacteristic(this.platform.Characteristic.Name, displayName);

    unitsCelsius.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    unitsCelsius.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    unitsCelsius.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getunitsCelsius.bind(this))
      .onSet(this.setunitsCelsius.bind(this));

  
    displayName = "Units: Fahrenheit"; 

    const unitsFahrenheit = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'units-fahrenheit-123');
    unitsFahrenheit.setCharacteristic(this.platform.Characteristic.Name, displayName);
    unitsFahrenheit.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    unitsFahrenheit.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    unitsFahrenheit.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getunitsFahrenheit.bind(this))
      .onSet(this.setunitsFahrenheit.bind(this));

  }
  
  //=====================================================================================
  async getunitsCelsius(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator' 
        && service.serviceType === 'cloud.smarthq.service.mode'
        && service.domainType === 'cloud.smarthq.domain.temperatureunits') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.mode == null) {
          this.platform.debug('blue', 'No state.mode returned from getunitsCelsius state');
          return false;
        }
        const units = state?.mode;
        if (units === 'cloud.smarthq.type.mode.celsius') {
          isOn = true;
        }
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setunitsCelsius(value: CharacteristicValue) {

    if (value) {
      const cmdBody = {
        command: {
          commandType: 'cloud.smarthq.command.mode.set',
          mode: 'cloud.smarthq.type.mode.celsius'
        },
        kind: 'service#command',
        deviceId: this.deviceId,
        serviceDeviceType: 'cloud.smarthq.device.refrigerator',
        serviceType: 'cloud.smarthq.service.mode',
        domainType: 'cloud.smarthq.domain.temperatureunits'
      };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setunitsCelsius command');
      return;
    }
    
      // Update the opposite switch
      const unitsFahrenheit = this.accessory.getService("Units: Fahrenheit");
      unitsFahrenheit?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    }
  }
  //=====================================================================================
  async getunitsFahrenheit(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator' 
        && service.serviceType === 'cloud.smarthq.service.mode'
        && service.domainType === 'cloud.smarthq.domain.temperatureunits') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.mode == null) {
          this.platform.debug('blue', 'No state.mode returned from getunitsFahrenheit state');
          return false;
        }
        const units = state?.mode;
        if (units === 'cloud.smarthq.type.mode.fahrenheit') {
          isOn = true;
        }
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setunitsFahrenheit(value: CharacteristicValue) {
    this.platform.debug("blue", "Triggered setunitsFahrenheit: " + value);
    if (value) {
      const cmdBody = {
        command: {
          commandType: 'cloud.smarthq.command.mode.set',
          mode: 'cloud.smarthq.type.mode.fahrenheit'
        },
        kind: 'service#command',
        deviceId: this.deviceId,
        serviceDeviceType: 'cloud.smarthq.device.refrigerator',
        serviceType: 'cloud.smarthq.service.mode',
        domainType: 'cloud.smarthq.domain.temperatureunits'
      };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setunitsFahrenheit command');
      return;
    }
    
      // Update the opposite switch
    // Update the opposite switch
      const unitsCelsius = this.accessory.getService("Units: Celsius");
      unitsCelsius?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    }
  }
}
