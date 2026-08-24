// These functions setup the various services for a dishwasher appliance
// imported into platform.ts
// Dishwasher always added; the rest are optional based on config settings

import { Dishwasher }         from './dishwasher/dishwasher.js';
import { ControlLock }        from './dishwasher/controlLock.js';
import { FanFresh }           from './dishwasher/fanFresh.js';
import { SabbathMode }        from './dishwasher/sabbathMode.js';
import { SoundOption }        from './dishwasher/soundOption.js';
import { PlatformAccessory }  from 'homebridge';
import { SmartHqPlatform }    from './platform.js';
import { DeviceService }      from 'ge-smarthq';


  export function setupDishwasherServices(this: SmartHqPlatform, accessory: PlatformAccessory, deviceServices: DeviceService[], deviceId: string, groupAccessory?: PlatformAccessory[]) {
    new Dishwasher(this, accessory, deviceServices, deviceId, groupAccessory ?? []);

    if (this.config.addDwSoundOption) {
      new SoundOption(this, accessory, deviceServices, deviceId);}

    if (this.config.addControlLock) {
      new ControlLock(this, accessory, deviceServices, deviceId);}
      
    if (this.config.addDwFanFresh) {
      new FanFresh(this, accessory, deviceServices, deviceId);} 

    if (this.config.addDwSabbath) {
      new SabbathMode(this, accessory, deviceServices, deviceId);}
  } 