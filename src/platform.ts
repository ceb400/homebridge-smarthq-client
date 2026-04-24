
import { API, DynamicPlatformPlugin, PlatformConfig, PlatformAccessory, Logger } from 'homebridge';
import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import { Device, SmartHQClient }  from 'ge-smarthq';
import chalk              from 'chalk';
// GE Devices
import { setupDishwasherServices }     from './dishwasherServices.js';
import { setupRefrigeratorServices }   from './refrigeratorServices.js';

export class SmartHqPlatform implements DynamicPlatformPlugin {
  private client: SmartHQClient;
  public readonly discoveredCacheUUIDs: string[] = [];
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public groupAccessoryArray: PlatformAccessory[] = [];

  constructor(
    public log: Logger, 
    public config: PlatformConfig,  
    public api: API
  ) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.client = new SmartHQClient(
      {
      clientId:     this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri:  this.config.redirectUri,
      debug:        this.config.debugLogging || false,
    }
  );
//=========================

    chalk.level = 1; // Enable chalk colors

    if (this.config.debugLogging) {
      this.log.info(chalk.green('Debug logging is enabled for SmartHQ Platform'));
    } 

    this.api.on('didFinishLaunching', async () => {
      const tstamp = new Date().toLocaleString('en-US')
    console.log(chalk.blue(`[${tstamp}] [Smarthq] Homebridge finished launching, starting SmartHQ authentication... `));

      try {
        this.debug('red', '(SmartHQ OAuth2 authentication starting)');
        await this.client.authenticate();
        this.debug('blue', '(SmartHQ OAuth2 authentication completed)');
      } catch (error) {
          this.log.error(chalk.red('SmartHQ OAuth2 authentication failed:'), error);
      }
    });
    // Listen for authComplete event to start device discovery
    this.client.on('authenticated', async () => {

      try {
      await this.discoverDevices();
      } catch (error) {
        this.log.error(chalk.red('Error during device discovery:'), error);
      }
    });
  }
  
  

  async discoverDevices() {
    const deviceList = await this.client.getDevices();
    // Create HomeKit accessories for each device
    // loop over the discovered devices and register each one if it has not already been registered
     
    for (const device of deviceList.devices) {
      this.log.info(chalk.yellow(`SmartHQ Discovered device: ${device.nickname} Model: ${device.model}`));

      // Used to acquire service IDs and service deviceTypes for deviceServiceState queries
      const response =  await this.client.getDevice(device.deviceId);
      const deviceServices = response.services ?? [];

      const sortedServices = deviceServices.sort((a, b) => {
        if (a.serviceDeviceType < b.serviceDeviceType) return -1;
        if (a.serviceDeviceType > b.serviceDeviceType) return 1;
        return 0;
      });

      if (this.config.debugServicesFridge && device.nickname === 'Refrigerator' 
        || this.config.debugServicesDishwasher && device.nickname === 'Dishwasher'
        || this.config.debugServicesAll) {
        for (const service of sortedServices) {
            this.log.info(chalk.yellow("ServiceId         = " + service.serviceId));
            this.log.info(chalk.yellow("ServiceDeviceType = " + service.serviceDeviceType));
            this.log.info(chalk.yellow("ServiceType       = " + service.serviceType));
            this.log.info(chalk.yellow("Domain            = " + service.domainType));
            this.log.info(chalk.blue("Supported Commands  = " + chalk.green(JSON.stringify(service.supportedCommands, null, 2))));
            this.log.info(chalk.yellow("Config            = " + chalk.green(JSON.stringify(service.config, null,2))));
            this.log.info(chalk.yellow("State             = " + chalk.red(JSON.stringify(service.state))));
            this.log.info("------------------------------------------------------------------------");
        }
      }

      const accessoryType = this.getAccessoryByDeviceId(device, '', device.nickname); // main accessory for device

      // For dishwasher create group accessory for wash mode, wash temp, dry levels
      if (device.nickname === 'Dishwasher') {
        this.debug('blue', `Creating group accessory for dishwasher modes for device ${device.nickname}`);
        const groupTemperatureUuid =  this.getAccessoryByDeviceId(device, 'tempmodes', 'Wash Temps');
        const groupDryerUuid =        this.getAccessoryByDeviceId(device, 'drymodes', 'Dry Levels');
        const groupZoneUuid =        this.getAccessoryByDeviceId(device, 'zonemodes', 'Wash Zones');
        const groupPresetsUuid =      this.getAccessoryByDeviceId(device, 'washmodes', 'Preset Modes');
        this.groupAccessoryArray = [groupTemperatureUuid!, groupDryerUuid!, groupZoneUuid!, groupPresetsUuid!];
      }

      // Setup services based on device type when there are multiple device types in account
      // add more case statements e.g. Washer, Dryer, Oven, etc.

      switch (device.nickname) {
        case 'Refrigerator':
          this.debug('green', `Setting up Refrigerator services for ${device.nickname}`);
          setupRefrigeratorServices.call(this, accessoryType!,  deviceServices, device.deviceId);
          break;
        case 'Dishwasher':
          this.debug('blue', `Setting up Dishwasher services for ${device.nickname}`);
          setupDishwasherServices.call(this, accessoryType!,  deviceServices, device.deviceId, this.groupAccessoryArray);
          break;
        default:
          this.debug('red', `not implemented device :  for device ${device.nickname}`);
      }
    }

    const params =  {
      "after": "7d"
    }

    const recentAlerts = await this.client.getRecentAlerts(params);     // prints alert messages to the log for any device
    for (const alert of recentAlerts.alerts) {
      this.debug('yellow', `Recent Alert at: ${alert.lastAlertTime} for device ${alert.deviceType}: ${alert.alertType}`);
    }

    // remove accessories from the cache which are no longer present
    
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
  }

  configureAccessory(accessory: PlatformAccessory) {

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }

  getAccessoryByDeviceId(device: Device, uuidSuffix: string, displayName: string): PlatformAccessory | undefined {
    let uuid: string;
    let anAccessory: PlatformAccessory | undefined;
    if (!uuidSuffix) {
      uuid = this.api.hap.uuid.generate(device.deviceId);
    } else {
      uuid = this.api.hap.uuid.generate(device.deviceId + '-' + uuidSuffix);
    }
    const existingAccessory = this.accessories.get(uuid);

    // for existing accessories restore from cache
    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
      existingAccessory.context.device = device;
      anAccessory = existingAccessory;
      this.api.updatePlatformAccessories([existingAccessory]);
    } else {
    // create new accessory
      this.log.info('Adding new accessory:', device.nickname);
      const accessory = new this.api.platformAccessory(displayName, uuid);

      accessory.context.device = device;
      anAccessory = accessory;
      this.log.info('Registering new accessory with Homebridge:', accessory.displayName); 
      this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]); 
    }
    this.discoveredCacheUUIDs.push(uuid);
  return anAccessory;
  }


  public debug(color: string, message: string) {
    if (this.config.debugLogging) {
      switch(color) {
        case 'red':
          this.log.info(chalk.red('[Smarthq] ' + message));
          break;
        case 'blue':
          this.log.info(chalk.blue('[Smarthq] ' + message));
          break;
        case 'green':
          this.log.info(chalk.green('[Smarthq] ' + message));
          break;
        case 'yellow':
          this.log.info(chalk.yellow('[Smarthq] ' + message));
          break;
        default:
          this.log.info('[Smarthq] ' + message);
      }
    } else {
        return;
    }
  }
}