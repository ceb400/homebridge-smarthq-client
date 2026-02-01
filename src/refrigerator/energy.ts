import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';
import { DevService } from '../smarthq-types.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EnergySensor {

  private readonly smartHqApi: SmartHqApi;
  private log : Logging;
  private prevKwhReading: number = 0;

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
    // Check to see if the device has any supported Energy Sensor services
    // If not, then don't add a service for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.meter', 
          'cloud.smarthq.service.meter',
          'cloud.smarthq.domain.energy')) {
      this.log.info('No supported Energy Sensor services found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding an Energy Sensor');

    //=====================================================================================
    // create a new water FilterMaintenance service for the Refrigerator
    // This works in Homebridge and HomeKit has a native FilterMaintenance service type but the Home app does not implement it yet 
    // so no sensor/accessory will show up in the Home app for this service type.
    //===================================================================================== 
    const displayName = "Watts/hr";
    const energySensor = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.TemperatureSensor, displayName, 'energy-2');
    energySensor.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    energySensor.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    const energyCurrent = energySensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature);

    //=====================================================================================
    // Now modify the properties for each characteristic to make the temperature sensor
    // function as an energy readout in kWh
    //=====================================================================================
    try {
      energyCurrent.setProps({
        unit: 'kWh',
        minValue: -30.0,
        maxValue: 50000000.0,
        minStep: 1.0
      });
    } catch (error) {
      this.platform.debug('blue', 'Error setting Energy sensor properties: ' + error);
    }

    //energySensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
    //  .onGet(this.getEnergyChange.bind(this));
    //=====================================================================================
    // Poll every 1800 seconds for new energy data
    //=====================================================================================
    setInterval(() => {
      this.getEnergyChange().then(temp => {
        energySensor.getCharacteristic(this.platform.Characteristic.CurrentTemperature).updateValue(temp);
      });
    }, 30 * 60 * 1000);
  
  }
  //=====================================================================================
  async getEnergyChange(): Promise<CharacteristicValue> {
    let kwhReading = 0
    for (const service of this.deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.meter' 
        && service.serviceType      === 'cloud.smarthq.service.meter') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state?.meterValue == null) {
          this.platform.debug('blue',  'No state.meterValue returned from getEnergyChange state');
          return false;
        }
        kwhReading = state?.meterValue;
        const intervalDelta = kwhReading - this.prevKwhReading;
        kwhReading = (intervalDelta * 2 - 32) / 1.8;  // Interval is 30 minutes so double to get hourly rate
        this.prevKwhReading = state?.meterValue;
        break;
      }
    }
    return kwhReading ; // Interval is 30 minutes so double to get hourly rate
  }
}
