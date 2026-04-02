import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TurboCoolMode {
  static turboCoolFreezerStatus = false;
  static turboCoolFridgeStatus = false;

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
    this.client = new SmartHQClient({
      clientId:       platform.config.clientId,
      clientSecret:   platform.config.clientSecret,
      redirectUri:    platform.config.redirectUri,
      debug:          platform.config.debugLogging || false,
    });

    //=====================================================================================
    // Check to see if the device has any supported Turbo Cool services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================
    let hasTurboCool = false;
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freshfood' 
        && service.serviceType      === 'cloud.smarthq.service.toggle'
        && service.domainType       === 'cloud.smarthq.domain.turbo') {
        hasTurboCool = true;
      }
    }
    if (!hasTurboCool) {
      this.client.debug('No supported Turbo Cool service found for device: ' + this.accessory.displayName);
      return;
    }
   
    this.client.debug('Adding Turbo Cool Mode Switches');

    //=====================================================================================
    // create a Turbo Cool Refrigerator mode switch for the Refrigerator 
    //=====================================================================================
    let displayName = "Turbo Cool Fridge"; 

    const turboCoolFridge = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'turbo-cool-123');
    turboCoolFridge.setCharacteristic(this.Characteristic.Name, displayName);

    turboCoolFridge.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    turboCoolFridge.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    turboCoolFridge.getCharacteristic(this.Characteristic.On)
      .onGet(this.getTurboCoolFridge.bind(this))
      .onSet(this.setTurboCoolFridge.bind(this));

    //=====================================================================================
    // create a Turbo Cool Freezer mode switch for the Freezer
    //=====================================================================================
    displayName = "Turbo Cool Freezer"; 

    const turboCoolFreezer = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'turbo-cool-freezer-123');
    turboCoolFreezer.setCharacteristic(this.Characteristic.Name, displayName);

    turboCoolFreezer.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    turboCoolFreezer.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    turboCoolFreezer.getCharacteristic(this.Characteristic.On)
      .onGet(this.getTurboCoolFreezer.bind(this))
      .onSet(this.setTurboCoolFreezer.bind(this));

  }
  
  //=====================================================================================
  async getTurboCoolFridge(): Promise<CharacteristicValue> {
    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freshfood' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.turbo') {
          try {
        const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
        if (response?.state?.on == null) {
          this.client.debug('No state.on returned from getTurboCoolFridge state');
          return false;
        }
        isOn = response?.state?.on === true;
      } catch (error) {
        this.client.debug('Error getting Turbo Cool Fridge state: ' + error);
        return false;
      }
      }
    }
    return isOn
  }

  //=====================================================================================
  async setTurboCoolFridge(value: CharacteristicValue) {
   
    const cmdBody = {
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.refrigerator.freshfood',
      serviceType: 'cloud.smarthq.service.toggle',
      domainType: 'cloud.smarthq.domain.turbo',
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      }
    };
    
    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setTurboCoolFridge command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setTurboCoolFridge command: ' + error);
    }
  }

  //=====================================================================================
  async getTurboCoolFreezer(): Promise<CharacteristicValue> {
    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freezer' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.turbo') {

        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response?.state?.on == null) {
            this.client.debug('No state.on returned from getTurboCoolFreezer state');
            return false;
          }
        isOn = response?.state?.on === true;
        } catch (error) {
          this.client.debug('Error getting Turbo Cool Freezer state: ' + error);
          return false;
        }
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setTurboCoolFreezer(value: CharacteristicValue) {
   
    const cmdBody = {
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType:  'cloud.smarthq.device.refrigerator.freezer',
      serviceType:        'cloud.smarthq.service.toggle',
      domainType:     'cloud.smarthq.domain.turbo',
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      }
    };
    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setTurboCoolFreezer command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setTurboCoolFreezer command: ' + error);
    }
  }
}
