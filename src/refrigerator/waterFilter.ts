import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';


/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class WaterFilter {
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
    // Check to see if the device has any supported FilterMaintenance services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================
    let hasFilterMaintenance = false;
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.waterfilter' 
        && service.serviceType      === 'cloud.smarthq.service.mode'
        && service.domainType       === 'cloud.smarthq.domain.state') {
        hasFilterMaintenance = true;
      }
    }
    if (!hasFilterMaintenance) {
      this.client.debug('No supported Filter Maintenance service found for device: ' + this.accessory.displayName);
      return;
    }
    this.client.debug('Adding a Water Filter Sensor');

    //=====================================================================================
    // create a new water FilterMaintenance service for the Refrigerator
    // This works in Homebridge and HomeKit has a native FilterMaintenance service type but the Home app does not implement it yet 
    // so no sensor/accessory will show up in the Home app for this service type.
    // Create a Lightbulb service instead and use the FilterMaintenance characteristics to show filter life and change indication. 
    //===================================================================================== 
    const displayName = "Filter Life";
    const displayName2 = "Filter Life Level";
    const refrigeratorWaterFilter = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.FilterMaintenance, displayName, 'filter-maintenance-1');
    refrigeratorWaterFilter.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    refrigeratorWaterFilter.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    // add a lightbulb service to show the filter life level as a percentage in the Home app 
    const refrigeratorPseudoFilter = this.accessory.getService(displayName2) 
    || this.accessory.addService(this.Service.Lightbulb, displayName2, 'filter-maintenance-2');

    this.client.debug('Adding a pseudo Water Filter Level indicator');
    refrigeratorPseudoFilter.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    refrigeratorPseudoFilter.setCharacteristic(this.Characteristic.ConfiguredName, displayName2)
    refrigeratorPseudoFilter.getCharacteristic(this.Characteristic.On).updateValue(true);
    refrigeratorPseudoFilter.getCharacteristic(this.Characteristic.Brightness)
      .onGet(this.getWaterFilterLifeLevel.bind(this))
      .onSet(this.getWaterFilterLifeLevel.bind(this)); 

    refrigeratorWaterFilter.getCharacteristic(this.Characteristic.FilterChangeIndication)
      .onGet(this.getWaterFilterChangeIndication.bind(this));
      refrigeratorWaterFilter.getCharacteristic(this.Characteristic.FilterLifeLevel)
      .onGet(this.getWaterFilterLifeLevel.bind(this));
  
  }
  //=====================================================================================
  async getWaterFilterChangeIndication(): Promise<CharacteristicValue> {
    let filterStatus = 0
    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.waterfilter' 
        && service.serviceType      === 'cloud.smarthq.service.mode') {

        const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
        if (response?.state?.mode == null) {
          console.debug('[SmartHq] No state.mode returned from getWaterFilterChangeIndication state');
          return false;
        }
        if (response?.state?.mode  === 'cloud.smarthq.type.mode.good'
          || response?.state?.mode === 'cloud.smarthq.type.mode.bypass'
          || response?.state?.mode === 'cloud.smarthq.type.mode.expiringsoon'
        ) {
            filterStatus = this.Characteristic.FilterChangeIndication.FILTER_OK;
        } else {
            filterStatus = this.Characteristic.FilterChangeIndication.CHANGE_FILTER;
        }
      }
    }
    return filterStatus;
  }

  //=====================================================================================
  async getWaterFilterLifeLevel(): Promise<CharacteristicValue> {
    
    let filterRemaining = 0;
    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.waterfilter' 
        && service.serviceType      === 'cloud.smarthq.service.integer') {

        try {
        const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
        if (response?.state?.value == null) {
          console.debug('[SmartHq] No value returned from getWaterFilterLifeLevel state');
          return false;
        }
        filterRemaining = Number(response?.state?.value);
        } catch (error) {
          console.error('[SmartHq] Error getting water filter life level:', error);
          return false;
        }
      }
    }
    // Update the Brightness characteristic of the pseudo filter service to show the filter life level as a percentage
      const filterLevel = this.accessory.getService("Filter Life Level");
      filterLevel?.getCharacteristic(this.Characteristic.Brightness).updateValue(filterRemaining);
    return filterRemaining;
  }

}
