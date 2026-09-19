/** @format */

import { Dehumidifier } from './dehumidifier/dehumidifier.js';
import { PlatformAccessory } from 'homebridge';
import { SmartHqPlatform } from './platform.js';
import { DeviceService } from 'ge-smarthq';

export function setupDehumidifierServices(
	this: SmartHqPlatform,
	accessory: PlatformAccessory,
	deviceServices: DeviceService[],
	deviceId: string,
) {
	return new Dehumidifier(this, accessory, deviceServices, deviceId);
}
