import { AirConditioner } from './airConditioner/airConditioner.js';
import { PlatformAccessory }  from 'homebridge';
import { SmartHqPlatform }    from './platform.js';
import { DeviceService }      from 'ge-smarthq';

export function setupAirConditionerServices(this: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string) {
  new AirConditioner(this, accessory, deviceServices, deviceId);
}
