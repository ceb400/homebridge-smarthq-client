import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SabbathMode {
  static sabbathModeStatus = false;private readonly smartHqApi: SmartHqApi;
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
    // Check to see if the device has any supported Sabbath Mode services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.appliance',
          'cloud.smarthq.service.toggle',
          'cloud.smarthq.domain.sabbath')) {
      this.log.info('No supported Sabbath Mode service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Sabbath Mode Switch');

    // set accessory information

    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    //=====================================================================================
    // create a sabbath mode switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Sabbath Mode"; 

    const sabbathMode = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'sabbathmode123');
    sabbathMode.setCharacteristic(this.platform.Characteristic.Name, displayName);

    sabbathMode.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    sabbathMode.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    sabbathMode.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getSabbathMode.bind(this))
      .onSet(this.setSabbathMode.bind(this));
}

  //=====================================================================================
  async getSabbathMode(): Promise<CharacteristicValue> {

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.appliance' 
        && service.serviceType      === 'cloud.smarthq.service.toggle'
        && service.domainType       === 'cloud.smarthq.domain.sabbath') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
          this.platform.debug('blue', 'No state.on returned from getSabbathMode state');
          return false;
        }
        SabbathMode.sabbathModeStatus = state?.on;
        break
      }
    }
    return SabbathMode.sabbathModeStatus;
  }

  //=====================================================================================
  async setSabbathMode(value: CharacteristicValue) {

    value = SabbathMode.sabbathModeStatus ? false : true;

    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      },
      kind:              'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.appliance',
      serviceType:       'cloud.smarthq.service.toggle',
      domainType:        'cloud.smarthq.domain.sabbath'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setSabbathMode command');
      return;
    }
  }
}
