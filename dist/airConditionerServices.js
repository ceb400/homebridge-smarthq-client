import { AirConditioner } from './airConditioner/airConditioner.js';
export function setupAirConditionerServices(accessory, deviceServices, deviceId) {
    new AirConditioner(this, accessory, deviceServices, deviceId);
}
//# sourceMappingURL=airConditionerServices.js.map