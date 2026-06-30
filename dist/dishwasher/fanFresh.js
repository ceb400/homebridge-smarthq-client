import { SmartHQClient } from 'ge-smarthq';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class FanFresh {
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
        if (!this.platform.config.addDwFanFresh) { // If user has not enabled Fan Fresh switch, then don't add it
            return;
        }
        let hasFanFresh = false;
        for (const service of deviceServices) {
            if (service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
                service.serviceType === "cloud.smarthq.service.toggle" &&
                service.domainType === "cloud.smarthq.domain.fan.fresh") {
                hasFanFresh = true;
                break;
            }
        }
        if (!hasFanFresh) {
            this.client.debug("No supported Fan Fresh service found for device: " +
                this.accessory.displayName);
            return;
        }
        // create a new fan Switch service ------------------------------------
        this.client.debug('Adding Dishwasher UltraFresh Fan Switch');
        const displayName = "UltraFresh Fan";
        const fanfresh = this.setupService('Switch', displayName, 'fanfresh-1234');
        fanfresh.getCharacteristic(this.Characteristic.On)
            .onGet(this.handleToggleGet.bind(this, 'cloud.smarthq.device.dishwasher', 'cloud.smarthq.domain.fan.fresh'))
            .onSet(this.handleToggleSet.bind(this, 'cloud.smarthq.device.dishwasher', 'cloud.smarthq.domain.fan.fresh'));
    }
    //=====================================================================================
    async handleToggleGet(deviceType, domain) {
        let isOn = false;
        for (const service of this.deviceServices) {
            if (service.serviceDeviceType === deviceType
                && service.serviceType === 'cloud.smarthq.service.toggle'
                && service.domainType === domain) {
                try {
                    const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
                    if (response?.state?.on == null) {
                        this.client.debug('No response from get command' + domain);
                        return false;
                    }
                    isOn = response?.state?.on === true;
                    break;
                }
                catch (error) {
                    this.client.debug('Error getting toggle state: ' + error);
                    return false;
                }
            }
        }
        return isOn;
    }
    //=====================================================================================
    async handleToggleSet(deviceType, domain, value) {
        ///if (value) {
        const cmdBody = {
            command: {
                commandType: 'cloud.smarthq.command.toggle.set',
                on: value
            },
            kind: 'service#command',
            deviceId: this.deviceId,
            serviceDeviceType: deviceType,
            serviceType: 'cloud.smarthq.service.toggle',
            domainType: domain
        };
        this.client.debug('cmdBody = ' + JSON.stringify(cmdBody, null, 2));
        try {
            const response = await this.client.sendCommand(cmdBody);
            if (response == null) {
                this.client.debug('No response from set command: ' + domain);
                return;
            }
            else {
                this.client.debug('Response fields are: ' + JSON.stringify(response, null, 2));
                this.client.debug('Response from set command for ' + domain + ': ' + response?.outcome);
            }
        }
        catch (error) {
            this.client.debug('Error sending set command: ' + error);
        }
    }
    setupService(serviceType, displayName, serviceIdSuffix) {
        let service;
        switch (serviceType) {
            case 'Outlet':
                service = this.accessory.getService(displayName)
                    || this.accessory.addService(this.Service.Outlet, displayName, serviceIdSuffix);
                break;
            case 'Switch':
                service = this.accessory.getService(displayName)
                    || this.accessory.addService(this.Service.Switch, displayName, serviceIdSuffix);
                break;
            default:
                this.client.debug('Unknown service type: ' + serviceType + '');
                service = this.accessory.getService(displayName) || this.accessory.addService(this.Service.Fan, displayName, serviceIdSuffix);
        }
        service.setCharacteristic(this.Characteristic.Name, displayName);
        service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);
        return service;
    }
}
//# sourceMappingURL=fanFresh.js.map