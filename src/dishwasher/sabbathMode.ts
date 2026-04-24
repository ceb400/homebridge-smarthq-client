import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SabbathMode {
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

    if (!this.platform.config.addDwSabbath) {     // If user has not enabled Sabbath Mode switch, then don't add it
      return;
    }

    //=====================================================================================
    // Check to see if the device has any supported Sabbath Mode services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================
    let hasSabbathMode = false;
    
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.appliance' 
        && service.serviceType      === 'cloud.smarthq.service.toggle' 
        && service.domainType       === 'cloud.smarthq.domain.sabbath') {
        hasSabbathMode = true;
        break;
      }
    }
    if (!hasSabbathMode) {
      console.log('[SmartHq] No supported Sabbath Mode service found for device: ' + this.accessory.displayName);
      return;
    }
    this.client.debug('Adding Sabbath Mode Switch');

    // set accessory information

    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    //=====================================================================================
    // create a sabbath mode switch for the Dishwasher
    //=====================================================================================
    const displayName = "Dw Sabbath Mode"; 

    const sabbathMode = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'sabbathmode234');
    sabbathMode.setCharacteristic(this.Characteristic.Name, displayName);

    sabbathMode.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    sabbathMode.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    sabbathMode.getCharacteristic(this.Characteristic.On)
      .onGet(this.getSabbathMode.bind(this))
      .onSet(this.setSabbathMode.bind(this));
}

  //=====================================================================================
  async getSabbathMode(): Promise<CharacteristicValue> {
    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.appliance' 
        && service.serviceType      === 'cloud.smarthq.service.toggle'
        && service.domainType       === 'cloud.smarthq.domain.sabbath') {

        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response?.state?.on == null) {
            this.client.debug('No state.on returned from getSabbathMode state');
            return false;
          }
          isOn = response?.state?.on === true;
          break;
        } catch (error) {
          this.client.debug('Error getting Sabbath Mode state: ' + error);
          return false;
        }
      }
    }
    return isOn;
  }

  //=====================================================================================
    async setSabbathMode(value: CharacteristicValue) {

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

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setSabbathMode command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setSabbathMode command: ' + error);
      
    }
  }
}
