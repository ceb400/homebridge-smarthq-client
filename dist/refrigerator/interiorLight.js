import { SmartHQClient } from 'ge-smarthq';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class InteriorLight {
    platform;
    accessory;
    deviceServices;
    deviceId;
    client;
    Service;
    Characteristic;
    api;
    constructor(platform, accessory, deviceServices, deviceId) {
        this.platform = platform;
        this.accessory = accessory;
        this.deviceServices = deviceServices;
        this.deviceId = deviceId;
        this.api = platform.api;
        this.Service = this.api.hap.Service;
        this.Characteristic = this.api.hap.Characteristic;
        this.accessory = accessory;
        this.deviceServices = deviceServices;
        this.deviceId = deviceId;
        this.client = new SmartHQClient({
            clientId: platform.config.clientId,
            clientSecret: platform.config.clientSecret,
            redirectUri: platform.config.redirectUri,
            debug: platform.config.debugLogging || false,
        });
        let hasInteriorLight = false;
        for (const service of deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator'
                && service.serviceType === 'cloud.smarthq.service.integer'
                && service.domainType === 'cloud.smarthq.domain.brightness.light') {
                hasInteriorLight = true;
            }
        }
        if (!hasInteriorLight) {
            this.client.debug('No supported Interior Light service found for device: ' + this.accessory.displayName);
            return;
        }
        this.client.debug('Adding Interior Light Switch');
        // set accessory information
        //=====================================================================================
        // create a new Lightbulb service for the Refrigerator Wall Brightness Light
        //=====================================================================================
        const displayName = "Fridge Light";
        const refrigeratorLight = this.accessory.getService(displayName)
            || this.accessory.addService(this.Service.Lightbulb, displayName, 'brightness-light-2');
        refrigeratorLight.setCharacteristic(this.Characteristic.Name, displayName);
        refrigeratorLight.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        refrigeratorLight.setCharacteristic(this.Characteristic.ConfiguredName, displayName);
        refrigeratorLight.getCharacteristic(this.Characteristic.On).updateValue(true);
        refrigeratorLight.getCharacteristic(this.Characteristic.On)
            .onGet(this.getRefrigBrightnessLightOn.bind(this))
            .onSet(this.setRefrigBrightnessLightOn.bind(this));
        refrigeratorLight.getCharacteristic(this.Characteristic.Brightness)
            .onGet(this.getFridgeBackLight.bind(this))
            .onSet(this.setFridgeBackLight.bind(this));
    }
    //=====================================================================================
    async getFridgeBackLight() {
        let brightness = 0;
        for (const service of this.deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator'
                && service.serviceType === 'cloud.smarthq.service.integer') {
                try {
                    const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
                    if (response?.state?.value == null) {
                        this.client.debug('No state.value returned from getFridgeBackLight state');
                        return false;
                    }
                    brightness = Number(response?.state?.value);
                    break;
                }
                catch (error) {
                    this.client.debug('Error getting Refrigerator Back Light value: ' + error);
                }
            }
        }
        return brightness;
    }
    //=====================================================================================
    // Set handler for Brightness  characteristics for Lightbulb service
    //=====================================================================================
    async setFridgeBackLight(value) {
        const cmdBody = {
            command: {
                commandType: 'cloud.smarthq.command.integer.set',
                value: value
            },
            kind: 'service#command',
            deviceId: this.deviceId,
            serviceDeviceType: 'cloud.smarthq.device.refrigerator',
            serviceType: 'cloud.smarthq.service.integer',
            domainType: 'cloud.smarthq.domain.brightness.light'
        };
        try {
            const response = await this.client.sendCommand(cmdBody);
            if (response == null) {
                this.client.debug('No response from setFridgeBackLight command');
                return;
            }
        }
        catch (error) {
            this.client.debug('Error sending setFridgeBackLight command: ' + error);
        }
    }
    ;
    //=====================================================================================
    async getRefrigBrightnessLightOn() {
        // SmartHQ API does not have an On/Off command for the refrigerator brightness light only brightness level 0-100
        return true;
    }
    //=====================================================================================
    async setRefrigBrightnessLightOn(value) {
        // SmartHQ API does not have an On/Off command for the refrigerator brightness light only brightness level 0-100
        if (value === false) {
            return;
        }
    }
}
//# sourceMappingURL=interiorLight.js.map