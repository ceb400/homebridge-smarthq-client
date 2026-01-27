import { CharacteristicValue, PlatformAccessory, PlatformConfig, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TurboCoolMode {
  static turboCoolFreezerStatus = false;
  static turboCoolFridgeStatus = false;

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
    // Check to see if the device has any supported Turbo Cool services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.refrigerator.freshfood',
          'cloud.smarthq.service.toggle',
          'cloud.smarthq.domain.turbo')) {
      this.log.info('No supported Turbo Cool service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Turbo Cool Mode Switches ');

    //=====================================================================================
    // create a Turbo Cool Refrigerator mode switch for the Refrigerator 
    //=====================================================================================
    let displayName = "Turbo Cool Fridge"; 

    const turboCoolFridge = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'turbo-cool-123');
    turboCoolFridge.setCharacteristic(this.platform.Characteristic.Name, displayName);

    turboCoolFridge.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    turboCoolFridge.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    turboCoolFridge.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getTurboCoolFridge.bind(this))
      .onSet(this.setTurboCoolFridge.bind(this));

    //=====================================================================================
    // create a Turbo Cool Freezer mode switch for the Freezer
    //=====================================================================================
    displayName = "Turbo Cool Freezer"; 

    const turboCoolFreezer = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'turbo-cool-freezer-123');
    turboCoolFreezer.setCharacteristic(this.platform.Characteristic.Name, displayName);

    turboCoolFreezer.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    turboCoolFreezer.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    turboCoolFreezer.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getTurboCoolFreezer.bind(this))
      .onSet(this.setTurboCoolFreezer.bind(this));

  }
  
  //=====================================================================================
  async getTurboCoolFridge(): Promise<CharacteristicValue> {

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freshfood' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.turbo') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
          this.platform.debug('blue', 'No state.on returned from getTurboCoolFridge state');
          return false;
        }
        TurboCoolMode.turboCoolFridgeStatus = state?.on;
      }
    }
    return TurboCoolMode.turboCoolFridgeStatus;
  }

  //=====================================================================================
  async setTurboCoolFridge(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setTurboCoolFridge  toggle");
   
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

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setTurboCoolFridge command');
      return;
    }
  }

  //=====================================================================================
  async getTurboCoolFreezer(): Promise<CharacteristicValue> {
    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.freezer' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.turbo') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
          this.platform.debug('blue', 'No state.on returned from getTurboCoolFreezer state');
          return false;
        }

        TurboCoolMode.turboCoolFreezerStatus = state?.on;
      }
    }
    return TurboCoolMode.turboCoolFreezerStatus;
  }

  //=====================================================================================
  async setTurboCoolFreezer(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setTurboCoolFreezer = toggle");
   
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

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setTurboCoolFreezer command');
      return;
    }
  }
}
