// These functions setup the various services for a refrigerator appliance
// imported into platform.ts
// Refrigerator and Freezer are always added; the rest are optional based on config settings

import { Refrigerator }       from './refrigerator/refrigerator.js';
import { Freezer }            from './refrigerator/freezer.js';
import { ControlLock }        from './refrigerator/controlLock.js';
import { ConvertibleDrawer }  from './refrigerator/convertibleDrawer.js';
import { DispenserLight }     from './refrigerator/dispenserLight.js';
import { EnergySensor }       from './refrigerator/energy.js';
import { IceMaker }           from './refrigerator/iceMaker.js';
import { InteriorLight }      from './refrigerator/interiorLight.js';
import { SabbathMode }        from './refrigerator/sabbathMode.js';
import { TemperatureUnits }   from './refrigerator/temperatureUnits.js';
import { TurboCoolMode }      from './refrigerator/turboCoolMode.js';
import { WaterFilter }        from './refrigerator/waterFilter.js';
import { RefrigeratorAlerts } from './refrigerator/refrigeratorAlerts.js';
import { DevService }         from './smarthq-types.js';
import { PlatformAccessory }  from 'homebridge';
import { SmartHqPlatform }    from './platform.js';
import { DevDevice }          from './smarthq-types.js';


  export function setupRefrigeratorServices(this: SmartHqPlatform, accessory: PlatformAccessory, device: DevDevice, deviceServices: DevService[]) {
    new Refrigerator(this, accessory, deviceServices, device.deviceId);
    new Freezer(this, accessory, deviceServices, device.deviceId);

    if (this.config.addConvertibleDrawer) {
      new ConvertibleDrawer(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addControlLock) {
      new ControlLock(this, accessory, deviceServices, device.deviceId);}
      
    if (this.config.addDispenserLight) {
      new DispenserLight(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addEnergyMonitor) {
      new EnergySensor(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addIceMaker) {
      new IceMaker(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addInteriorLight) {
      new InteriorLight(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addSabbathMode) {
      new SabbathMode(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addTemperatureUnits) {
      new TemperatureUnits(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addTurboCool) {
      new TurboCoolMode(this, accessory, deviceServices, device.deviceId);}

    if (this.config.addWaterFilter) {
      new WaterFilter(this, accessory, deviceServices, device.deviceId); }

    if (this.config.addAlerts) {
      new RefrigeratorAlerts(this, accessory, deviceServices, device.deviceId); }
  } 