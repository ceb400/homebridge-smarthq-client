import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';

/**
 * Platform Accessory
 * An instance of this class is created for each accessory your platform registers
 * Each accessory may expose multiple services of different service types.
 */
export class ConvertibleDrawer {
  private client: SmartHQClient;
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  private readonly api: API;

  //-------------------  Convertible Drawer Temperature Service -----------------------
  private convertibleDrawerMode = {
    MEAT: "cloud.smarthq.type.mode.convertibledrawer.mode3",
    BEVERAGES: "cloud.smarthq.type.mode.convertibledrawer.mode4",
    SNACKS: "cloud.smarthq.type.mode.convertibledrawer.mode5",
    WINE: "cloud.smarthq.type.mode.convertibledrawer.mode6",
};

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

    //=====================================================================================
    // Check to see if the device has any supported Convertible Drawer services
    // If not, then don't add services for device that doesn't support it
    //=====================================================================================

    let hasConvertibleDrawer = false;
    for (const service of deviceServices) {
      if (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer'
          && service.serviceType      === 'cloud.smarthq.service.mode'
          && service.domainType       === 'cloud.smarthq.domain.mode.selection') {
        hasConvertibleDrawer = true;
      }
    }
  
    if (!hasConvertibleDrawer) {
      this.client.debug('No supported Convertible Drawer service found for device: ' + this.accessory.displayName);
      return;
    }
    this.client.debug('Adding Convertible Drawer Switches');
    
    // set accessory information
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.model || 'Default-Model')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

     
    //=====================================================================================
    // create some new Switch services for the Refrigerator to be used like radio buttons
    // to set the Convertible Drawer modes (Snacks, Meat, Beverages, Wine)
    //=====================================================================================
    let displayName = "Drawer Meat";

    const convertibleDrawerMeat = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'drawer-mode-3');
    convertibleDrawerMeat.setCharacteristic(this.Characteristic.Name, displayName);
    convertibleDrawerMeat.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    convertibleDrawerMeat.setCharacteristic(this.Characteristic.ConfiguredName, displayName)
    displayName = "Drawer Beverages";

    const convertibleDrawerBeverages = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'drawer-mode-4');
    convertibleDrawerBeverages.setCharacteristic(this.Characteristic.Name, displayName);
    convertibleDrawerBeverages.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    convertibleDrawerBeverages.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    displayName = "Drawer Snacks";

    const convertibleDrawerSnacks = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'drawer-mode-5');
    convertibleDrawerSnacks.setCharacteristic(this.Characteristic.Name, displayName);
    convertibleDrawerSnacks.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    convertibleDrawerSnacks.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    displayName = "Drawer Wine";
    const convertibleDrawerWine = this.accessory.getService(displayName) 
    || this.accessory.addService(this.Service.Switch, displayName, 'drawer-mode-6');
    convertibleDrawerWine.setCharacteristic(this.Characteristic.Name, displayName);
    convertibleDrawerWine.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    convertibleDrawerWine.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    // create handlers for required characteristics
    convertibleDrawerSnacks.getCharacteristic(this.Characteristic.On)
      .onGet(this.getConvertibleDrawerSnacks.bind(this))
      .onSet(this.setConvertibleDrawerSnacks.bind(this));

    convertibleDrawerMeat.getCharacteristic(this.Characteristic.On)
      .onGet(this.getConvertibleDrawerMeat.bind(this))
      .onSet(this.setConvertibleDrawerMeat.bind(this));

    convertibleDrawerBeverages.getCharacteristic(this.Characteristic.On)
      .onGet(this.getConvertibleDrawerBeverages.bind(this))
      .onSet(this.setConvertibleDrawerBeverages.bind(this));

    convertibleDrawerWine.getCharacteristic(this.Characteristic.On)
      .onGet(this.getConvertibleDrawerWine.bind(this))
      .onSet(this.setConvertibleDrawerWine.bind(this));

    // Service for Convertible Drawer Temperature Sensor
    
    displayName = "Drawer Temp";  
    const drawerTemperature = this.accessory.getService(displayName) 
      || this.accessory.addService(this.Service.TemperatureSensor, displayName, 'drawer-temp-1');
    drawerTemperature.setCharacteristic(this.Characteristic.Name, displayName);
    drawerTemperature.addOptionalCharacteristic(this.Characteristic.ConfiguredName)
    drawerTemperature.setCharacteristic(this.Characteristic.ConfiguredName, displayName)

    drawerTemperature.getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(this.getDrawerTemperature.bind(this));
    
  }

  //=====================================================================================
  async getDrawerTemperature(): Promise<CharacteristicValue> {
    let temp = 0;
    let mode = '';

    // First you need to find which mode is set for the Convertible Drawer

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === 'cloud.smarthq.device.refrigerator.convertibledrawer' 
        && service.serviceType       === 'cloud.smarthq.service.mode') {
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.mode) {
            this.client.debug('No mode returned from getDrawerTemperature state');
            break;     // an invalid mode value will be used below so no match will be found
          }
          mode = String(response?.state?.mode).split('.').pop() ?? ''; 
          break;

        } catch (error) {
          this.client.debug('Error getting drawer temperature mode: ' + error);
        }
      } 
    }
    // Add the 'mode' to serviceDeviceType to get the correct temperature service

    for (const service of this.deviceServices) {
      if  (service.serviceDeviceType === `cloud.smarthq.device.refrigerator.convertibledrawer.${mode}` 
        && service.serviceType       === 'cloud.smarthq.service.temperature') {
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.celsiusConverted) {
            this.client.debug('No celsiusConverted returned from getDrawerTemperature state');
            return false;
          }
          temp = Number(response?.state?.celsiusConverted);
          break;
        } catch (error) {
          this.client.debug('Error getting drawer temperature: ' + error);
          return false;
        }
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
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.mode) {
            this.client.debug('No mode returned from getConvertibleDrawerSnacks state');
            return false;
          }
          
          isOn = response?.state?.mode === snacks;
          break;
        } catch (error) {
          this.client.debug('Error getting Convertible Drawer Snacks state: ' + error);
          return false;
        }
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

        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.mode) {
            this.client.debug('No mode returned from getConvertibleDrawerMeat state');
            return false;
          }
          
          isOn = response?.state?.mode === meat;
          break;
        } catch (error) {
          this.client.debug('Error getting Convertible Drawer Meat state: ' + error);
          return false;
        }
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
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.mode) {
            this.client.debug('No mode returned from getConvertibleDrawerBeverages state');
            return false;
          }
          
          isOn = response?.state?.mode === beverages;
          break;
        } catch (error) {
          this.client.debug('Error getting Convertible Drawer Beverages state: ' + error);
          return false;
        }
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
        try {
          const response = await this.client.getServiceDetails(this.deviceId, service.serviceId);
          if (response == null || !response?.state?.mode) {
            this.client.debug('No mode returned from getConvertibleDrawerWine state');
            return false;
          }
          
          isOn = response?.state?.mode === wine;
          break;
        } catch (error) {
          this.client.debug('Error getting Convertible Drawer Wine state: ' + error);
          return false;
        }
      } 
    }
    return isOn;
  }

//=====================================================================================
  async setConvertibleDrawerMeat(value: CharacteristicValue) {
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

      try {
        const response = await this.client.sendCommand(cmdBody);

        if (response != null) {
          // Update the switches for Wine, Snacks, Beverages to off
          const switchSnacks = this.accessory.getService("Drawer Snacks");
          switchSnacks?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchBeverages = this.accessory.getService("Drawer Beverages");
          switchBeverages?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchWine = this.accessory.getService("Drawer Wine"); 
          switchWine?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
      } catch (error) {
        this.client.debug('Error sending setConvertibleDrawerMeat command: ' + error);
      }
    }
  }

//=====================================================================================
  async setConvertibleDrawerBeverages(value: CharacteristicValue) {
    if (value === true) {
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

      try {
        const response = await this.client.sendCommand(cmdBody);

        if (response != null) {
          // Update the switches for Wine, Snacks, Meat to off
          const switchSnacks = this.accessory.getService("Drawer Snacks");
          switchSnacks?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchWine = this.accessory.getService("Drawer Wine");
          switchWine?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchMeat = this.accessory.getService("Drawer Meat");
          switchMeat?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
      } catch (error) {
        this.client.debug('Error sending setConvertibleDrawerBeverages command: ' + error);
      }
    }
  }

//=====================================================================================
  async setConvertibleDrawerSnacks(value: CharacteristicValue) {
    if (value === true) {
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

      try {
        const response = await this.client.sendCommand(cmdBody);

        if (response != null) {
          // Update the switches for Wine, Meat, Beverages to off
          const switchMeat = this.accessory.getService("Drawer Meat");
          switchMeat?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchBeverages = this.accessory.getService("Drawer Beverages");
          switchBeverages?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchWine = this.accessory.getService("Drawer Wine");
          switchWine?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
      } catch (error) {
        this.client.debug('Error sending setConvertibleDrawerSnacks command: ' + error);
      }
    }
  }
  //=====================================================================================
  async setConvertibleDrawerWine(value: CharacteristicValue) {
    if (value === true) {
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

      try {
        const response = await this.client.sendCommand(cmdBody);

        if (response != null) {
        // Update the switches for Meat, Snacks, Beverages to off
          const switchSnacks = this.accessory.getService("Drawer Snacks");
          switchSnacks?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchBeverages = this.accessory.getService("Drawer Beverages");
          switchBeverages?.getCharacteristic(this.Characteristic.On).updateValue(false);
          const switchMeat = this.accessory.getService("Drawer Meat");
          switchMeat?.getCharacteristic(this.Characteristic.On).updateValue(false);
        }
      } catch (error) {
        this.client.debug('Error sending setConvertibleDrawerWine command: ' + error);
      }
    }
  }
}
  
 