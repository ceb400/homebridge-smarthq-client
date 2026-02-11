import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class WaterFilter {

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
    // Check to see if the device has any supported FilterMaintenance services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.waterfilter',
          'cloud.smarthq.service.mode',
          'cloud.smarthq.domain.state')) {
      this.log.info('No supported FilterMaintenance service found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding a Water Filter Sensor');

    //=====================================================================================
    // create a new water FilterMaintenance service for the Refrigerator
    // This works in Homebridge and HomeKit has a native FilterMaintenance service type but the Home app does not implement it yet 
    // so no sensor/accessory will show up in the Home app for this service type.
    // Create a Lightbulb service instead and use the FilterMaintenance characteristics to show filter life and change indication. 
    //===================================================================================== 
    const displayName = "Filter Life";
    const displayName2 = "Filter Life Level";
    const refrigeratorWaterFilter = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.FilterMaintenance, displayName, 'filter-maintenance-1');
    refrigeratorWaterFilter.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    refrigeratorWaterFilter.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    // add a lightbulb service to show the filter life level as a percentage in the Home app 
    const refrigeratorPseudoFilter = this.accessory.getService(displayName2) 
    || this.accessory.addService(this.platform.Service.Lightbulb, displayName2, 'filter-maintenance-2');

    this.platform.debug('green', 'Adding a pseudo Water Filter Level indicator');
    refrigeratorPseudoFilter.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    refrigeratorPseudoFilter.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName2)
    refrigeratorPseudoFilter.getCharacteristic(this.platform.Characteristic.On).updateValue(true);
    refrigeratorPseudoFilter.getCharacteristic(this.platform.Characteristic.Brightness)
      .onGet(this.getWaterFilterLifeLevel.bind(this))
      .onSet(this.getWaterFilterLifeLevel.bind(this)); 

    refrigeratorWaterFilter.getCharacteristic(this.platform.Characteristic.FilterChangeIndication)
      .onGet(this.getWaterFilterChangeIndication.bind(this));
      refrigeratorWaterFilter.getCharacteristic(this.platform.Characteristic.FilterLifeLevel)
      .onGet(this.getWaterFilterLifeLevel.bind(this));
      
    
  
  }
  //=====================================================================================
  async getWaterFilterChangeIndication(): Promise<CharacteristicValue> {
    let filterStatus = 0
    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.waterfilter' 
        && service.serviceType      === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.mode == null) {
          this.platform.debug('blue', 'No state.mode returned from getWaterFilterChangeIndication state');
          return false;
        }
        if (state?.mode  === 'cloud.smarthq.type.mode.good'
          || state?.mode === 'cloud.smarthq.type.mode.bypass'
          || state?.mode === 'cloud.smarthq.type.mode.expiringsoon'
        ) {
            filterStatus = this.platform.Characteristic.FilterChangeIndication.FILTER_OK;
        } else {
            filterStatus = this.platform.Characteristic.FilterChangeIndication.CHANGE_FILTER;
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

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.value == null) {
          this.platform.debug('blue', 'No value returned from getWaterFilterLifeLevel state');
          return false;
        }
        filterRemaining = state?.value;
      }
    }
    // Update the Brightness characteristic of the pseudo filter service to show the filter life level as a percentage
      const filterLevel = this.accessory.getService("Filter Life Level");
      filterLevel?.getCharacteristic(this.platform.Characteristic.Brightness).updateValue(filterRemaining);
    return filterRemaining;
  }

}
