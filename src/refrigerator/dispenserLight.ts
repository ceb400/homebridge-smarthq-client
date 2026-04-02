import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class DispenserLight {
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
    // Check to see if the device has any supported Dispenser Light services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    let hasDispenserLight = false;
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.dispenser.light'
        && service.serviceType      === 'cloud.smarthq.service.toggle'
        && service.domainType       === 'cloud.smarthq.domain.activate.motion') {
        hasDispenserLight = true;
      }
    }
    if (!hasDispenserLight) {
      this.client.debug('No supported Dispenser Light service found for device: ' + this.accessory.displayName);
      return;
    }
  
    this.client.debug('Adding Dispenser Light Switch');

    //=====================================================================================
    // create a Dispenser Light switch for the Refrigerator 
    //=====================================================================================
    const displayName = "Dispenser Light"; 

    const dispenserLight = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'dispenser-light-123');
    dispenserLight.setCharacteristic(this.Characteristic.Name, displayName);

    dispenserLight.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    dispenserLight.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    
    dispenserLight.getCharacteristic(this.Characteristic.On)
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
          try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response?.state?.on == null) {
              this.client.debug('No response from getdispenserLight command');
              isOn = false;
          }
          isOn = response?.state?.on === true;
          break;
        }
          catch (error) {
            this.client.debug('Error getting dispenser light state: ' + error);
          }
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

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        console.debug('[SmartHq] No response from setdispenserLight command');
        return;
      }
    } catch (error) {
      console.debug('[SmartHq] Error sending setdispenserLight command: ' + error);
    }
  }
}
