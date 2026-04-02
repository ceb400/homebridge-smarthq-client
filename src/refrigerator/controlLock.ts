import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ControlLock {
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
    // Check to see if the device has any supported Convertible Drawer services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================
    // Some models may not have all services available so don't add service if not supported
    let hasControlLock = false;
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.appliance' 
        && service.serviceType      === 'cloud.smarthq.service.toggle'
        && service.domainType       === 'cloud.smarthq.domain.controls.lock') {
        hasControlLock = true;
      }
    }
    if (!hasControlLock) {
      this.client.debug('No supported Control Lock service found for device: ' + this.accessory.displayName);
      return;
    }
    
    this.client.debug('Adding Controls Lock Switch');

    //=====================================================================================
    // create a Control Lock switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Controls Lock"; 

    const controlsLock = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'control-lock-123');
    controlsLock.setCharacteristic(this.Characteristic.Name, displayName);

    controlsLock.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    controlsLock.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    controlsLock.getCharacteristic(this.Characteristic.On)
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
          try {
            const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
            if (response?.state?.on == null) {
                this.client.debug('No response from getcontrolsLock command');
                return false;
            }
            isOn = response?.state?.on === true;
            break;
          } catch (error) {
              this.client.debug('Error getting Control Lock state: ' + error);
              return false;
          }
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

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from setcontrolsLock command');
        return;
      }
    } catch (error) {
      this.client.debug('Error sending setcontrolsLock command: ' + error);
    }
  }
}
