import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DispenserLight {
private readonly smartHqApi: SmartHqApi;
  private log : Logging;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: DevService[],
    public readonly deviceId: string
    ) {
    this.platform = platform;
    this.accessory = accessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.log = platform.log;

    this.smartHqApi = new SmartHqApi(this.platform); 
    //=====================================================================================
    // Check to see if the device has any supported Convertible Drawer services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.refrigerator.dispenser.light',
          'cloud.smarthq.service.toggle',
          'cloud.smarthq.domain.activate.motion')) {
      this.log.info('No supported Dispenser Light service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Dispenser Light Switch');

    //=====================================================================================
    // create a Dispenser Light switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Dispenser Light"; 

    const dispenserLight = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'dispenser-light-123');
    dispenserLight.setCharacteristic(this.platform.Characteristic.Name, displayName);

    dispenserLight.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    dispenserLight.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    dispenserLight.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getdispenserLight.bind(this))
      .onSet(this.setdispenserLight.bind(this));

  }
  
  //=====================================================================================
  async getdispenserLight(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.dispenser.light' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.activate.motion') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
          this.platform.debug('blue','No On returned from getdispenserLight state');
          return false;
        }
        isOn = state?.on;
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setdispenserLight(value: CharacteristicValue) {
   
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      },
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.refrigerator.dispenser.light',
      serviceType: 'cloud.smarthq.service.toggle',
      domainType: 'cloud.smarthq.domain.activate.motion'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setdispenserLight command');
      return;
    }
    this.platform.debug('blue', 'setdispenserLight response: ' + response.outcome);
  }
}
