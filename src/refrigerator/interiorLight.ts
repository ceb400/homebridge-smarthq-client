import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class InteriorLight {
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
          'cloud.smarthq.device.refrigerator',
          'cloud.smarthq.service.integer',
          'cloud.smarthq.domain.brightness.light')) {
      this.log.info('No supported Interior Light service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Interior Light Switch');
    // set accessory information
    
    //=====================================================================================
    // create a new Lightbulb service for the Refrigerator Wall Brightness Light
    //=====================================================================================
    const displayName = "Fridge Light"; 
    const refrigeratorLight = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Lightbulb, displayName, 'brightness-light-2');
    
    refrigeratorLight.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    refrigeratorLight.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    refrigeratorLight.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    refrigeratorLight.getCharacteristic(this.platform.Characteristic.On).updateValue(true);
    refrigeratorLight.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getRefrigBrightnessLightOn.bind(this))
      .onSet(this.setRefrigBrightnessLightOn.bind(this));

    refrigeratorLight.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getFridgeBackLight.bind(this))
      .onSet(this.setFridgeBackLight.bind(this));
}


  //=====================================================================================
  async getFridgeBackLight(): Promise<CharacteristicValue> {
    let brightness = 0;
    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator' 
        && service.serviceType       === 'cloud.smarthq.service.integer') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.value == null) {
          this.platform.debug('blue', 'No state.value returned from getFridgeBackLight state');
          return false;
        }
        brightness = state?.value;
        break;
      } 
    }
    return brightness;
  }
  //=====================================================================================
  // Set handler for Brightness  characteristics for Lightbulb service
  //=====================================================================================
  async setFridgeBackLight(value: CharacteristicValue) {

    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.integer.set',
        value: value as number
      },
      kind:               'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType:  'cloud.smarthq.device.refrigerator',
      serviceType:        'cloud.smarthq.service.integer',
      domainType:         'cloud.smarthq.domain.brightness.light'
    };
    
    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response == null) {
      this.platform.debug('blue', 'No response from setFridgeBackLight command');
      return;
    }
};
 
  //=====================================================================================
  async getRefrigBrightnessLightOn() {
    // SmartHQ API does not have an On/Off command for the refrigerator brightness light only brightness level 0-100
    return true;
  }

  //=====================================================================================
  async setRefrigBrightnessLightOn(value: CharacteristicValue) {
    // SmartHQ API does not have an On/Off command for the refrigerator brightness light only brightness level 0-100
    if (value === false) {
      return
    }
    
  }
}
