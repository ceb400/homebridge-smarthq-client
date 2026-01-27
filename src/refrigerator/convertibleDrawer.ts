import { CharacteristicValue, PlatformAccessory, PlatformConfig, Logging } from 'homebridge';
import { SmartHqPlatform } from '../platform.js';
import { SmartHqApi } from '../smartHqApi.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ConvertibleDrawer {
  private readonly smartHqApi: SmartHqApi;

  //-------------------  Convertible Drawer Temperature Service -----------------------
  private convertibleDrawerMode = {
    MEAT: "cloud.smarthq.type.mode.convertibledrawer.mode3",
    BEVERAGES: "cloud.smarthq.type.mode.convertibledrawer.mode4",
    SNACKS: "cloud.smarthq.type.mode.convertibledrawer.mode5",
    WINE: "cloud.smarthq.type.mode.convertibledrawer.mode6",
};

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

    //=====================================================================================
    // Check to see if the device has any supported Convertible Drawer services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    if (!this.platform.deviceSupportsThisService(this.deviceServices, 
          'cloud.smarthq.device.refrigerator.convertibledrawer',
          'cloud.smarthq.service.mode',
          'cloud.smarthq.domain.mode.selection')) {
      this.log.info('No supported Convertible Drawer services found for device: ' + this.accessory.displayName);
      return;
    }
    this.platform.debug('green', 'Adding Convertible Drawer Switches');
    
    // set accessory information
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.platform.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.platform.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

     
    //=====================================================================================
    // create some new Switch services for the Refrigerator to be used like radio buttons
    // to set the Convertible Drawer modes (Snacks, Meat, Beverages, Wine)
    //=====================================================================================
    let displayName = "Drawer Meat";

    const convertibleDrawerMeat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'drawer-mode-3');
    convertibleDrawerMeat.setCharacteristic(this.platform.Characteristic.Name, displayName);
    convertibleDrawerMeat.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    convertibleDrawerMeat.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)
    displayName = "Drawer Beverages";

    const convertibleDrawerBeverages = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'drawer-mode-4');
    convertibleDrawerBeverages.setCharacteristic(this.platform.Characteristic.Name, displayName);
    convertibleDrawerBeverages.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    convertibleDrawerBeverages.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    displayName = "Drawer Snacks";

    const convertibleDrawerSnacks = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'drawer-mode-5');
    convertibleDrawerSnacks.setCharacteristic(this.platform.Characteristic.Name, displayName);
    convertibleDrawerSnacks.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    convertibleDrawerSnacks.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    displayName = "Drawer Wine";
    const convertibleDrawerWine = this.accessory.getService(displayName) 
    || this.accessory.addService(this.platform.Service.Switch, displayName, 'drawer-mode-6');
    convertibleDrawerWine.setCharacteristic(this.platform.Characteristic.Name, displayName);
    convertibleDrawerWine.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    convertibleDrawerWine.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    // create handlers for required characteristics
    convertibleDrawerSnacks.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getConvertibleDrawerSnacks.bind(this))
      .onSet(this.setConvertibleDrawerSnacks.bind(this));

    convertibleDrawerMeat.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getConvertibleDrawerMeat.bind(this))
      .onSet(this.setConvertibleDrawerMeat.bind(this));

    convertibleDrawerBeverages.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getConvertibleDrawerBeverages.bind(this))
      .onSet(this.setConvertibleDrawerBeverages.bind(this));

    convertibleDrawerWine.getCharacteristic(this.platform.Characteristic.On)
      .onGet(this.getConvertibleDrawerWine.bind(this))
      .onSet(this.setConvertibleDrawerWine.bind(this));

    // Service for Convertible Drawer Temperature Sensor
    
    displayName = "Drawer Temp";  
    const drawerTemperature = this.accessory.getService(displayName) 
      || this.accessory.addService(this.platform.Service.TemperatureSensor, displayName, 'drawer-temp-1');
    drawerTemperature.setCharacteristic(this.platform.Characteristic.Name, displayName);
    drawerTemperature.addOptionalCharacteristic(this.platform.Characteristic.ConfiguredName)
    drawerTemperature.setCharacteristic(this.platform.Characteristic.ConfiguredName, displayName)

    drawerTemperature.getCharacteristic(this.platform.Characteristic.CurrentTemperature)
      .onGet(this.getDrawerTemperature.bind(this));
    
  }

  //=====================================================================================
  async getDrawerTemperature(): Promise<CharacteristicValue> {
    var temp = 0;
    var mode = '0';

    // First you need to find which mode is set for the Convertible Drawer

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.mode) {
          this.platform.debug('blue', 'No mode returned from getDrawerTemperature state');
          break;     // an invalid mode value will be used below so no match will be found
        }
        let result = state?.mode.lastIndexOf(".");
        mode = state?.mode.slice(result + 1); 
        break;
      } 
    }

    // Add the 'mode' to serviceDeviceType to get the correct temperature service

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === `cloud.smarthq.device.refrigerator.convertibledrawer.${mode}` 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.celsiusConverted) {
          this.platform.debug('blue', 'No celsiusConverted returned from getDrawerTemperature state');
          return false;
        }
        temp = state?.celsiusConverted;
        break;
      } 
    }
    return temp;
  }

//=====================================================================================
  async getConvertibleDrawerSnacks(): Promise<CharacteristicValue> {
    // Find current mode and return true if = mode5 (Snacks)
    const snacks = 'cloud.smarthq.type.mode.convertibledrawer.mode5';
    let isOn = false;

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.mode) {
          this.platform.debug('blue', 'No mode returned from getConvertibleDrawerSnacks state');
          return false;
        }
        
        if (state?.mode === snacks) {
          isOn = true;
        }
        break;
      } 
    }
    return isOn;
  }

//=====================================================================================
  async getConvertibleDrawerMeat(): Promise<CharacteristicValue> {
    const meat = 'cloud.smarthq.type.mode.convertibledrawer.mode3';
    // Find current mode and return true if = mode3 (Meat)
    let isOn = false;

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.mode) {
          this.platform.debug('blue', 'No mode returned from getConvertibleDrawerMeat state');
          return false;
        }
        
        if (state?.mode === meat) {
          isOn = true;
        }
        break;
      } 
    }
    return isOn;
  }

//=====================================================================================
  async getConvertibleDrawerBeverages(): Promise<CharacteristicValue> {
    const beverages = 'cloud.smarthq.type.mode.convertibledrawer.mode4';
    // Find current mode and return true if = mode4 (Beverages)
    let isOn = false;

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.mode) {
          this.platform.debug('blue', 'No mode returned from getConvertibleDrawerBeverages state');
          return false;
        }
        
        if (state.mode === beverages) {
          isOn = true;
        }
        break;
      } 
    }
    return isOn;
  }

//=====================================================================================
  async getConvertibleDrawerWine(): Promise<CharacteristicValue> {
    const wine = 'cloud.smarthq.type.mode.convertibledrawer.mode6';
    // Find current mode and return true if = mode6 (Wine)
    let isOn = false;

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {

        const state = await this.smartHqApi.getServiceState(this.deviceId, service.serviceId);
        if (state == null || !state?.mode) {
          this.platform.debug('blue', 'No mode returned from getConvertibleDrawerWine state');
          return false;
        }
        
        if (state.mode === wine) {
          isOn = true;
        }
        break;
      } 
    }
    return isOn;
  }

//=====================================================================================
  async setConvertibleDrawerMeat(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setConvertibleDrawerMeat");
    if (value === true) {
      const cmdBody = {
        command: {
          commandType: 'cloud.smarthq.command.mode.set',
          mode: this.convertibleDrawerMode.MEAT
        },
        kind:              'service#command',
        deviceId:           this.deviceId,
        serviceDeviceType: 'cloud.smarthq.device.refrigerator.convertibledrawer',
        serviceType:       'cloud.smarthq.service.mode',
        domainType:        'cloud.smarthq.domain.mode.selection'
      };

      const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

      if (response != null) {
        // Update the switches for Wine, Snacks, Beverages to off
        const switchSnacks = this.accessory.getService("Drawer Snacks");
        switchSnacks?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        const switchBeverages = this.accessory.getService("Drawer Beverages");
        switchBeverages?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
        const switchWine = this.accessory.getService("Drawer Wine");
        switchWine?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      }
    }
  }

//=====================================================================================
  async setConvertibleDrawerBeverages(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setConvertibleDrawerBeverages");
    
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.mode.set',
        mode: this.convertibleDrawerMode.BEVERAGES
      },
      kind:              'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.refrigerator.convertibledrawer',
      serviceType:       'cloud.smarthq.service.mode',
      domainType:        'cloud.smarthq.domain.mode.selection'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response != null) {
      // Update the switches for Wine, Snacks, Meat to off
      const switchSnacks = this.accessory.getService("Drawer Snacks");
      switchSnacks?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchWine = this.accessory.getService("Drawer Wine");
      switchWine?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchMeat = this.accessory.getService("Drawer Meat");
      switchMeat?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    }
  }

//=====================================================================================
  async setConvertibleDrawerSnacks(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setConvertibleDrawerSnacks");

    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.mode.set',
        mode:         this.convertibleDrawerMode.SNACKS
      },
      kind:              'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.refrigerator.convertibledrawer',
      serviceType:       'cloud.smarthq.service.mode',
      domainType:        'cloud.smarthq.domain.mode.selection'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response != null) {
      // Update the switches for Wine, Meat, Beverages to off
      const switchMeat = this.accessory.getService("Drawer Meat");
      switchMeat?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchBeverages = this.accessory.getService("Drawer Beverages");
      switchBeverages?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchWine = this.accessory.getService("Drawer Wine");
      switchWine?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    }
  }
  //=====================================================================================
  async setConvertibleDrawerWine(value: CharacteristicValue) {
    this.platform.debug('blue', "Triggered setConvertibleDrawerWine");
   
    const cmdBody = {
      command: {
        commandType: 'cloud.smarthq.command.mode.set',
        mode:         this.convertibleDrawerMode.WINE
      },
      kind:              'service#command',
      deviceId:           this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.refrigerator.convertibledrawer',
      serviceType:       'cloud.smarthq.service.mode',
      domainType:        'cloud.smarthq.domain.mode.selection'
    };

    const response = await this.smartHqApi.command(JSON.stringify(cmdBody));

    if (response != null) {
    // Update the switches for Meat, Snacks, Beverages to off
      const switchSnacks = this.accessory.getService("Drawer Snacks");
      switchSnacks?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchBeverages = this.accessory.getService("Drawer Beverages");
      switchBeverages?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
      const switchMeat = this.accessory.getService("Drawer Meat");
      switchMeat?.getCharacteristic(this.platform.Characteristic.On).updateValue(false);
    }
  }
}
  
 