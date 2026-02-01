import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IceMaker {

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

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.icemaker.1',
          'cloud.smarthq.service.toggle',
          'cloud.smarthq.domain.power')) {
      this.log.info('No supported Ice Maker service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Ice Maker Switch'); 

    //=====================================================================================
    // create a Ice Maker switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Ice Maker"; 

    const iceMaker = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'ice-maker-123');
    iceMaker.setCharacteristic(this.platform.Characteristic.Name, displayName);

    iceMaker.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    iceMaker.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    
    iceMaker.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.geticeMaker.bind(this))
      .onSet(this.seticeMaker.bind(this));

  }
  
  //=====================================================================================
  async geticeMaker(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.icemaker.1' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.power') {
        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.on == null) {
          this.platform.debug('blue', 'No state.On returned from geticeMaker state');
          return false;
        }
        isOn = state?.on;
      }
    }
    return isOn;
  }

  //=====================================================================================
  async seticeMaker(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered seticeMaker  toggle");
   
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      },
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.icemaker.1',
      serviceType: 'cloud.smarthq.service.toggle',
      domainType: 'cloud.smarthq.domain.power'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from seticeMaker command');
      return;
    }
  }
}
