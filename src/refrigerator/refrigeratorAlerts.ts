import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService, AlertMessage } from 'ge-smarthq';
import { SmartHqPlatform }              from '../platform.js';

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

  private client: SmartHQClient;
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  private readonly api: API;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: DeviceService[],
    public readonly deviceId: string,
    ) {

    this.api = platform.api; 
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.accessory = accessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.client = new SmartHQClient({
      clientId:       platform.config.clientId,
      clientSecret:   platform.config.clientSecret,
      redirectUri:    platform.config.redirectUri,
      debug:          platform.config.debugLogging || false,
    });

     this.setupWebSocket();
    /*
     *  Listen for WebSocket messages for this device and update HomeKit characteristics accordingly
    */
   // Listen for connection state
   /*
    this.client.on('connected', () => {
      this.client.debug('Refrig-Alerts connected');
    });
    */
    this.client.on('alert', (message: AlertMessage) => {
      //this.client.debug('Refrig-Alerts Alert:'+ JSON.stringify(message));
      const alertType = message.alertType; 

      if (alertType.includes('door.alarm')) {
        this.setAlertDoorOn(true);
      } else if (alertType.includes('temperature.high')) {
        this.setAlertTemperatureOn(true);
      } else if (alertType.includes('leak')) {
        this.setAlertLeakOn(true);
      } else if (alertType.includes('filter')) {
        this.setAlertFilterOn(true);
      } else if (alertType.includes('ota.update')) {
        this.setAlertUpdateOn(true);
      }
    });
    this.client.on('presence', (message: string) => {
      this.client.debug('Refrig-Alerts Presence:'+ JSON.stringify(message));
    });
    this.client.on('command_outcome', (message: string) => {
      this.client.debug('Refrig-Alerts Command Outcome:'+ JSON.stringify(message, null, 2));
    });

    this.client.debug('Adding alert/notification Switches');
    // set accessory information
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    
    //=====================================================================================
    // create new Switch services for notifications/alerts. 
    // These switches can be used with Pushover switches in Homekit automations to send notifications to your iOS devices
    // Switches created here will be turned ON when an alert is detected and can be reset to OFF automatically or manually
    // Alerts include: Door Open Alarms, High Temperature Alarms, Water Leak Alerts, Water Filter Change Alerts, OTA Updates(firmware) 
    //=====================================================================================
    let displayName = "Alert Door"; 
    const alertDoor = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, displayName);
    
    alertDoor.setCharacteristic(this.Characteristic.Name,  displayName);
    alertDoor.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    alertDoor.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    alertDoor.getCharacteristic(this.Characteristic.On)
      .onGet(this.getAlertDoorOn.bind(this))
      .onSet(this.setAlertDoorOn.bind(this));

    displayName = "Alert Temp"; 
    const alertTemp = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, displayName);
    
    alertTemp.setCharacteristic(this.Characteristic.Name,  displayName);
    alertTemp.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    alertTemp.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    alertTemp.getCharacteristic(this.Characteristic.On)
      .onGet(this.getAlertTemperatureOn.bind(this))
      .onSet(this.setAlertTemperatureOn.bind(this));

    displayName = "Alert Leak"; 
    const alertLeak = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, displayName);
    
    alertLeak.setCharacteristic(this.Characteristic.Name,  displayName);
    alertLeak.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    alertLeak.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    alertLeak.getCharacteristic(this.Characteristic.On)
      .onGet(this.getAlertLeakOn.bind(this))
      .onSet(this.setAlertLeakOn.bind(this));

    displayName = "Alert Filter"; 
    const alertFilter = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, displayName);
    
    alertFilter.setCharacteristic(this.Characteristic.Name,  displayName);
    alertFilter.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    alertFilter.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    alertFilter.getCharacteristic(this.Characteristic.On)
      .onGet(this.getAlertFilterOn.bind(this))
      .onSet(this.setAlertFilterOn.bind(this));

    displayName = "Alert Firm"; 
    const alertFirm = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, displayName);
    
    alertFirm.setCharacteristic(this.Characteristic.Name,  displayName);
    alertFirm.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    alertFirm.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    alertFirm.getCharacteristic(this.Characteristic.On)
      .onGet(this.getAlertUpdateOn.bind(this))
      .onSet(this.setAlertUpdateOn.bind(this));
     
  //=====================================================================================
  // Updating characteristics values asynchronously.
  //=====================================================================================
  
  setInterval(() => {
    // push the new value to HomeKit
    this.getAlertDoorOn().then(state => {
      alertDoor.getCharacteristic(this.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertDoorOn(false);  
      }
    });
    this.getAlertTemperatureOn().then(state => {
      alertTemp.getCharacteristic(this.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertTemperatureOn(false);  
      }
    });
    this.getAlertLeakOn().then(state => {
      alertLeak.getCharacteristic(this.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertLeakOn(false);  
      }
    });
    this.getAlertFilterOn().then(state => {
      alertFilter.getCharacteristic(this.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertFilterOn(false);  
      }
    });
    this.getAlertUpdateOn().then(state => {
      alertFirm.getCharacteristic(this.Characteristic.On).updateValue(state);
      if (state) {
        this.setAlertUpdateOn(false);  
      }
    });
  }, 6000);
}
  async setupWebSocket() {
    try {
        await this.client.connect();
      } catch (error) {
        console.log('Failed to connect to SmartHQ WebSocket during platform initialization: ' + error);
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
