import { SmartHQClient } from 'ge-smarthq';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class TemperatureUnits {
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
        //=====================================================================================
        // Check to see if the device has any supported Temperature Units services
        // If not, then don't add services for device that doesn't support it
        //=====================================================================================
        let hasTemperatureUnits = false;
        for (const service of deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator'
                && service.serviceType === 'cloud.smarthq.service.mode'
                && service.domainType === 'cloud.smarthq.domain.temperatureunits') {
                hasTemperatureUnits = true;
            }
        }
        if (!hasTemperatureUnits) {
            console.log('[SmartHq] No supported Temperature Units service found for device: ' + this.accessory.displayName);
            return;
        }
        this.client.debug('Adding Temperature Units Switches');
        //=====================================================================================
        // create Temperature Unit switches for the Refrigerator 
        //=====================================================================================
        let displayName = "Units: Celsius";
        const unitsCelsius = this.accessory.getService(displayName)
            || this.accessory.addService(this.Service.Switch, displayName, 'units-celsius-123');
        unitsCelsius.setCharacteristic(this.Characteristic.Name, displayName);
        unitsCelsius.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        unitsCelsius.setCharacteristic(this.Characteristic.ConfiguredName, displayName);
        unitsCelsius.getCharacteristic(this.Characteristic.On)
            .onGet(this.getunitsCelsius.bind(this))
            .onSet(this.setunitsCelsius.bind(this));
        displayName = "Units: Fahrenheit";
        const unitsFahrenheit = this.accessory.getService(displayName)
            || this.accessory.addService(this.Service.Switch, displayName, 'units-fahrenheit-123');
        unitsFahrenheit.setCharacteristic(this.Characteristic.Name, displayName);
        unitsFahrenheit.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        unitsFahrenheit.setCharacteristic(this.Characteristic.ConfiguredName, displayName);
        unitsFahrenheit.getCharacteristic(this.Characteristic.On)
            .onGet(this.getunitsFahrenheit.bind(this))
            .onSet(this.setunitsFahrenheit.bind(this));
    }
    //=====================================================================================
    async getunitsCelsius() {
        let isOn = false;
        for (const service of this.deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator'
                && service.serviceType === 'cloud.smarthq.service.mode'
                && service.domainType === 'cloud.smarthq.domain.temperatureunits') {
                try {
                    const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
                    if (response?.state?.mode == null) {
                        this.client.debug('No state.mode returned from getunitsCelsius state');
                        return false;
                    }
                    const units = response?.state?.mode;
                    if (units === 'cloud.smarthq.type.mode.celsius') {
                        isOn = true;
                    }
                }
                catch (error) {
                    this.client.debug('Error getting units Celsius state: ' + error);
                    return false;
                }
            }
        }
        return isOn;
    }
    //=====================================================================================
    async setunitsCelsius(value) {
        if (value) {
            const cmdBody = {
                command: {
                    commandType: 'cloud.smarthq.command.mode.set',
                    mode: 'cloud.smarthq.type.mode.celsius'
                },
                kind: 'service#command',
                deviceId: this.deviceId,
                serviceDeviceType: 'cloud.smarthq.device.refrigerator',
                serviceType: 'cloud.smarthq.service.mode',
                domainType: 'cloud.smarthq.domain.temperatureunits'
            };
            try {
                const response = await this.client.sendCommand(cmdBody);
                if (response == null) {
                    this.client.debug('No response from setunitsCelsius command');
                    return;
                }
            }
            catch (error) {
                this.client.debug('Error sending setunitsCelsius command: ' + error);
                return;
            }
            // Update the opposite switch
            const unitsFahrenheit = this.accessory.getService("Units: Fahrenheit");
            unitsFahrenheit?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
    }
    //=====================================================================================
    async getunitsFahrenheit() {
        let isOn = false;
        for (const service of this.deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator'
                && service.serviceType === 'cloud.smarthq.service.mode'
                && service.domainType === 'cloud.smarthq.domain.temperatureunits') {
                try {
                    const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
                    if (response?.state?.mode == null) {
                        this.client.debug('No state.mode returned from getunitsFahrenheit state');
                        return false;
                    }
                    const units = response?.state?.mode;
                    if (units === 'cloud.smarthq.type.mode.fahrenheit') {
                        isOn = true;
                    }
                }
                catch (error) {
                    this.client.debug('Error getting units Fahrenheit state: ' + error);
                    return false;
                }
            }
        }
        return isOn;
    }
    //=====================================================================================
    async setunitsFahrenheit(value) {
        if (value) {
            const cmdBody = {
                command: {
                    commandType: 'cloud.smarthq.command.mode.set',
                    mode: 'cloud.smarthq.type.mode.fahrenheit'
                },
                kind: 'service#command',
                deviceId: this.deviceId,
                serviceDeviceType: 'cloud.smarthq.device.refrigerator',
                serviceType: 'cloud.smarthq.service.mode',
                domainType: 'cloud.smarthq.domain.temperatureunits'
            };
            try {
                const response = await this.client.sendCommand(cmdBody);
                if (response == null) {
                    this.client.debug('No response from setunitsFahrenheit command');
                    return;
                }
            }
            catch (error) {
                this.client.debug('Error sending setunitsFahrenheit command: ' + error);
                return;
            }
            // Update the opposite switch
            // Update the opposite switch
            const unitsCelsius = this.accessory.getService("Units: Celsius");
            unitsCelsius?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
    }
}
//# sourceMappingURL=temperatureUnits.js.map