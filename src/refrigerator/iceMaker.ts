import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class IceMaker {
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

    this.client.debug('Adding Ice Maker Switch'); 

    //=====================================================================================
    // create a Ice Maker switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Ice Maker"; 

    const iceMaker = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'ice-maker-123');
    iceMaker.setCharacteristic(this.Characteristic.Name, displayName);

    iceMaker.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    iceMaker.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    iceMaker.getCharacteristic(this.Characteristic.On)
      .onGet(this.getIceMaker.bind(this))
      .onSet(this.setIceMaker.bind(this));

  }
  
  //=====================================================================================
  async getIceMaker(): Promise<CharacteristicValue> {

    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.icemaker.1' 
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === 'cloud.smarthq.domain.power') {
          try {
            const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
            if (response?.state?.on == null) {
              this.client.debug('No state.On returned from geticeMaker state');
              return false;
            }
            isOn = response?.state?.on === true;
            break;
        } catch (error) {
          this.client.debug('Error getting Ice Maker state: ' + error);
        }
      }
    }
    return isOn;
  }

  //=====================================================================================
  async setIceMaker(value: CharacteristicValue) {
   
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

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setIceMaker command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setIceMaker command: ' + error);
    }

  }
}