import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class SoundOption {
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


    if (!this.platform.config.addDwSound) {     // If user has not enabled Sound Option switch, then don't add it
      return;
    }

    let hasSoundOption = false;
    for (const service of deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.appliance" &&
        service.serviceType === "cloud.smarthq.service.toggle" &&
        service.domainType === "cloud.smarthq.domain.sound"
      ) {
        hasSoundOption = true;
        break;
      }
    }
    if (!hasSoundOption) {
      this.client.debug(
        "No supported Sound Option service found for device: " +
          this.accessory.displayName,
      );
      return;
    }
        // create a new sound Switch service ------------------------------------
    this.client.debug('Adding Dishwasher Sound Switch');
    
    const displayName = "Sound Switch"; 

    const dishsound = this.setupService('Switch', displayName, 'dishsound-1234');

      dishsound.getCharacteristic(this.Characteristic.On)
        .onGet(this.handleToggleGet.bind(this, 'cloud.smarthq.device.appliance', 'cloud.smarthq.domain.sound'))
        .onSet(this.handleToggleSet.bind(this, 'cloud.smarthq.device.appliance', 'cloud.smarthq.domain.sound'));
  }
  
  //=====================================================================================
  
  async handleToggleGet(deviceType: string, domain: string): Promise<CharacteristicValue> {
    let isOn = false;

    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === deviceType
        && service.serviceType === 'cloud.smarthq.service.toggle'
        && service.domainType === domain) {
          try {
            const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
            if (response?.state?.on == null) {
                this.client.debug('No response from get command' + domain);
                return false;
            }
            isOn = response?.state?.on === true;
            break;
          } catch (error) {
              this.client.debug('Error getting toggle state: ' + error);
              return false;
          }
      }
    }
    return isOn;
  }

  //=====================================================================================
  async handleToggleSet(deviceType: string, domain: string, value: CharacteristicValue) {
    ///if (value) {
    
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.toggle.set',
        on: value
      },
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: deviceType,
      serviceType: 'cloud.smarthq.service.toggle',
      domainType: domain 
    };

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug('No response from set command: ' + domain);
        return;
      } else {
        this.client.debug('Response from set command for ' + domain + ': ' + response?.outcome);
      }
    } catch (error) {
      this.client.debug('Error sending set command: ' + error);
    }
  }

  setupService(serviceType: string, displayName: string, serviceIdSuffix: string) {
    let service: Service;

    switch(serviceType) {
      case 'Outlet':
        service = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Outlet, displayName, serviceIdSuffix);
          break;

      case 'Switch':
        service = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, serviceIdSuffix);
        break;

      default:
        this.client.debug('Unknown service type: ' + serviceType + '');
        service = this.accessory.getService(displayName) || this.accessory.addService(this.Service.Fan, displayName, serviceIdSuffix);
    }
    
    service.setCharacteristic(this.Characteristic.Name, displayName);
    service.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    return service
  }

}
