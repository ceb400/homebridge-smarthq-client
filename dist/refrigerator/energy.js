import { SmartHQClient } from 'ge-smarthq';
/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class EnergySensor {
    platform;
    accessory;
    deviceServices;
    deviceId;
    client;
    Service;
    Characteristic;
    api;
    prevKwhReading = 0;
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
        // Check to see if the device has any supported Energy Sensor services
        // If not, then don't add a service for device that doesn't support it
        //=====================================================================================
        let hasEnergyMeter = false;
        for (const service of deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.meter'
                && service.serviceType === 'cloud.smarthq.service.meter'
                && service.domainType === 'cloud.smarthq.domain.energy') {
                hasEnergyMeter = true;
            }
        }
        if (!hasEnergyMeter) {
            this.client.debug('No supported Energy Meter service found for device: ' + this.accessory.displayName);
            return;
        }
        this.client.debug('Adding an Energy Sensor');
        //=====================================================================================
        // create a new water FilterMaintenance service for the Refrigerator
        // This works in Homebridge and HomeKit has a native FilterMaintenance service type but the Home app does not implement it yet 
        // so no sensor/accessory will show up in the Home app for this service type.
        //===================================================================================== 
        const displayName = "Watts/hr";
        const energySensor = this.accessory.getService(displayName)
            || this.accessory.addService(this.Service.TemperatureSensor, displayName, 'energy-2');
        energySensor.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        energySensor.setCharacteristic(this.Characteristic.ConfiguredName, displayName);
        const energyCurrent = energySensor.getCharacteristic(this.Characteristic.CurrentTemperature);
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
        }
        catch (error) {
            this.client.debug('Error setting Energy sensor properties: ' + error);
        }
        //energySensor.getCharacteristic(this.Characteristic.CurrentTemperature)
        //  .onGet(this.getEnergyChange.bind(this));
        //=====================================================================================
        // Poll every 1800 seconds for new energy data
        //=====================================================================================
        setInterval(() => {
            this.getEnergyChange().then(temp => {
                energySensor.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temp);
            });
        }, 30 * 60 * 1000);
    }
    //=====================================================================================
    async getEnergyChange() {
        let kwhReading = 0;
        for (const service of this.deviceServices) {
            if (service.serviceDeviceType === 'cloud.smarthq.device.meter'
                && service.serviceType === 'cloud.smarthq.service.meter') {
                try {
                    const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
                    if (response?.state?.meterValue == null) {
                        this.client.debug('No state.meterValue returned from getEnergyChange state');
                        return false;
                    }
                    kwhReading = Number(response?.state?.meterValue);
                    const intervalDelta = kwhReading - this.prevKwhReading;
                    kwhReading = (intervalDelta * 2 - 32) / 1.8; // Interval is 30 minutes so double to get hourly rate
                    this.prevKwhReading = Number(response?.state?.meterValue);
                    break;
                }
                catch (error) {
                    this.client.debug('Error getting Energy Meter value: ' + error);
                    return false;
                }
            }
        }
        return kwhReading * 2; // Interval is 30 minutes so double to get hourly rate
    }
}
;
//# sourceMappingURL=energy.js.map