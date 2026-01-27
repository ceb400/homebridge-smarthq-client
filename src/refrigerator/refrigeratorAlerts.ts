import { CharacteristicValue, PlatformAccessory, Logging } from 'homebridge';
import { SmartHqPlatform }  from '../platform.js';
import { SmartHqApi }       from '../smartHqApi.js';
import chalk                from 'chalk';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * These switches can be used with Pushover switches in Homekit automations to send notifications to your iOS devices
 */
export class RefrigeratorAlerts {
 
  private alertDoorState: boolean = false;
  private alertLeakState: boolean = false;
  private alertFilterState: boolean = false;
  private alertTemperatureState: boolean = false;
  private alertUpdateState: boolean = false;
    
  private readonly smartHqApi: SmartHqApi;
  private log : Logging;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: any[],
    public readonly deviceId: string
    ) {
    this.platform = platform;
    this.accessory = accessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.log = platform.log;

    this.smartHqApi = new SmartHqApi(this.platform);  
    this.platform.debug('green', 'Adding alert/notification Switches');
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    
    //=====================================================================================
    // create new Switch services for notifications/alerts. 
    // These switches can be used with Pushover switches in Homekit automations to send notifications to your iOS devices
    // Switches created here will be turned ON when an alert is detected and can be reset to OFF automatically or manually
    // Alerts include: Door Open Alarms, High Temperature Alarms, Water Leak Alerts, Water Filter Change Alerts, OTA Updates(firmware) 
    //=====================================================================================
    let displayName = "Alert Door"; 
    const alertDoor = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, displayName);
    
    alertDoor.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    alertDoor.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    alertDoor.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    alertDoor.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAlertDoorOn.bind(this))
      .onSet(this.setAlertDoorOn.bind(this));

    displayName = "Alert Temp"; 
    const alertTemp = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, displayName);
    
    alertTemp.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    alertTemp.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    alertTemp.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    alertTemp.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAlertTemperatureOn.bind(this))
      .onSet(this.setAlertTemperatureOn.bind(this));

    displayName = "Alert Leak"; 
    const alertLeak = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, displayName);
    
    alertLeak.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    alertLeak.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    alertLeak.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    alertLeak.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAlertLeakOn.bind(this))
      .onSet(this.setAlertLeakOn.bind(this));

    displayName = "Alert Filter"; 
    const alertFilter = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, displayName);
    
    alertFilter.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    alertFilter.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    alertFilter.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    alertFilter.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAlertFilterOn.bind(this))
      .onSet(this.setAlertFilterOn.bind(this));

    displayName = "Alert Firm"; 
    const alertFirm = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, displayName);
    
    alertFirm.setCharacteristic(this.platform.Characteristic.Name,  displayName);
    alertFirm.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    alertFirm.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    alertFirm.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getAlertUpdateOn.bind(this))
      .onSet(this.setAlertUpdateOn.bind(this));
     
  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getAlertDoorOn().then(state => {
      alertDoor.getCharacteristic(this.platform.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertDoorOn(false);  
      }
    });
    this.getAlertTemperatureOn().then(state => {
      alertTemp.getCharacteristic(this.platform.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertTemperatureOn(false);  
      }
    });
    this.getAlertLeakOn().then(state => {
      alertLeak.getCharacteristic(this.platform.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertLeakOn(false);  
      }
    });
    this.getAlertFilterOn().then(state => {
      alertFilter.getCharacteristic(this.platform.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertFilterOn(false);  
      }
    });
    this.getAlertUpdateOn().then(state => {
      alertFirm.getCharacteristic(this.platform.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertUpdateOn(false);  
      }
    });
  }, 5000);

  setInterval(() => {
      this.checkForAlerts();
  }, 60000);
  
}

//=====================================================================================
  // Check for any alerts - filter for last minute
  //=====================================================================================
  async checkForAlerts() {
    const alerts = await this.smartHqApi.getRecentAlerts();
    if (alerts == null) {
      return;
    }
    for (const alert of alerts) {
      const type = alert.alertType;
      if (type.includes('door.alarm')) {
        this.log.warn(chalk.yellow(`Alert: ${alert.alertType} `));
        this.setAlertDoorOn(true);
      } else if (type.includes('temperature.high')) {
        this.log.warn(chalk.red(`Alert: ${alert.alertType} `));
        this.setAlertTemperatureOn(true);
      } else if (type.includes('leak')) {
        this.log.warn(chalk.red(`Alert: ${alert.alertType} `));
        this.setAlertLeakOn(true);
      } else if (type.includes('filter')) {
        this.log.warn(chalk.red(`Alert: ${alert.alertType} `));
        this.setAlertFilterOn(true);
      } else if (type.includes('ota.update')) {
        this.log.warn(chalk.red(`Alert: ${alert.alertType} `));
        this.setAlertUpdateOn(true);
      }
    }
  }


  getAlertDoorOn(): Promise<CharacteristicValue> {
    const currentValue = this.alertDoorState;

    return Promise.resolve(currentValue);
  }
  getAlertTemperatureOn(): Promise<CharacteristicValue> {
    const currentValue = this.alertTemperatureState;

    return Promise.resolve(currentValue);
  }
  getAlertFilterOn(): Promise<CharacteristicValue> {
    const currentValue = this.alertFilterState;

    return Promise.resolve(currentValue);
  }
  getAlertUpdateOn(): Promise<CharacteristicValue> {
    const currentValue = this.alertUpdateState;

    return Promise.resolve(currentValue);
  }
  getAlertLeakOn(): Promise<CharacteristicValue> {
    const currentValue = this.alertLeakState;

    return Promise.resolve(currentValue);
  }

  /**
   * Handle requests to set the "On" characteristic
   */
  setAlertDoorOn(value: CharacteristicValue) {
    this.alertDoorState = value as boolean;
    // Will reset the alert (turn switch OFF) after 5 seconds by code in the setInterval function above
  }
  setAlertTemperatureOn(value: CharacteristicValue) {
    this.alertTemperatureState = value as boolean;
    // Will reset the alert (turn switch OFF) after 5 seconds by code in the setInterval function above
  }
  setAlertFilterOn(value: CharacteristicValue) {
    this.alertFilterState = value as boolean;
    // Will reset the alert (turn switch OFF) after 5 seconds by code in the setInterval function above
  }
  setAlertUpdateOn(value: CharacteristicValue) {
    this.alertUpdateState = value as boolean;
    // Will reset the alert (turn switch OFF) after 5 seconds by code in the setInterval function above
  }
  setAlertLeakOn(value: CharacteristicValue) {
    this.alertLeakState = value as boolean;
    // Will reset the alert (turn switch OFF) after 5 seconds by code in the setInterval function above
  }
}
