import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ControlLock {
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
          'cloud.smarthq.device.appliance',
          'cloud.smarthq.service.toggle',
          'cloud.smarthq.domain.controls.lock')) {
      this.log.info('No supported Control Lock service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Controls Lock Switch');

    //=====================================================================================
    // create a Control Lock switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Controls Lock"; 

    const controlsLock = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'control-lock-123');
    controlsLock.setCharacteristic(this.platform.Characteristic.Name, displayName);

    controlsLock.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    controlsLock.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    controlsLock.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getcontrolsLock.bind(this))
      .onSet(this.setcontrolsLock.bind(this));

  }
  
  //=====================================================================================
  async getcontrolsLock(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.appliance' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.controls.lock') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
            this.platform.debug('blue', 'No response from setcontrolsLock command');
            return false;
        }
        isOn = state?.on;
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setcontrolsLock(value: CharacteristicValue) {
   
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      },
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.appliance',
      serviceType: 'cloud.smarthq.service.toggle',
      domainType: 'cloud.smarthq.domain.controls.lock' 
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setcontrolsLock command');
      return;
    }
    this.platform.debug('blue', 'setcontrolsLock response: ' + response.outcome);
  }
}
