import {
  API,
  DynamicPlatformPlugin,
  PlatformConfig,
  PlatformAccessory,
  Logger,
} from 'homebridge';

import { PLATFORM_NAME, PLUGIN_NAME } from './settings.js';

import { Device, SmartHQClient } from 'ge-smarthq-api';
import chalk from 'chalk';

// GE Devices
import { setupDishwasherServices } from './dishwasherServices.js';
import { setupRefrigeratorServices } from './refrigeratorServices.js';
import { setupAirConditionerServices } from './airConditionerServices.js';
import { AirConditioner } from './airConditioner/airConditioner.js';

export class SmartHqPlatform implements DynamicPlatformPlugin {
  private client: SmartHQClient;

  private readonly airConditioners = new Map<string, AirConditioner>();

  // Use Set instead of array (critical fix)
  private readonly discoveredCacheUUIDs = new Set<string>();

  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public groupAccessoryArray: PlatformAccessory[] = [];

  private discovering = false;

  constructor(
    public log: Logger,
    public config: PlatformConfig,
    public api: API,
  ) {
    this.log = log;
    this.config = config;
    this.api = api;

    this.client = new SmartHQClient({
      clientId: this.config.clientId,
      clientSecret: this.config.clientSecret,
      redirectUri: this.config.redirectUri,
      debug: this.config.debugLogging || false,
    });

    chalk.level = 1;

    if (this.config.debugLogging) {
      this.log.info(chalk.green('Debug logging is enabled for SmartHQ Platform'));
    }

    this.api.on('didFinishLaunching', async () => {
      const tstamp = new Date().toLocaleString('en-US');

      this.log.info(
        chalk.blue(
          `[${tstamp}] [Smarthq] Homebridge finished launching, starting SmartHQ authentication...`,
        ),
      );

      try {
        this.debug('red', '(SmartHQ OAuth2 authentication starting)');
        this.debug('white', 'Using ' + process.cwd() + '/smarthq.token.json');
        await this.client.authenticate();
        this.debug('blue', '(SmartHQ OAuth2 authentication succeeded)');
      } catch (error) {
        this.log.error(chalk.red('SmartHQ OAuth2 authentication failed:'), error);
      }
    });

    this.client.on('authenticated', async () => {
      try {
        await this.discoverDevices();
      } catch (error) {
        this.log.error(chalk.red('Error during device discovery:'), error);
      }
    });
  }

  // =========================================================
  // DEVICE DISCOVERY
  // =========================================================
  async discoverDevices() {
    // prevent duplicate concurrent discovery runs
    if (this.discovering) return;
    this.discovering = true;

    // reset tracking each run
    this.discoveredCacheUUIDs.clear();

    try {
      const deviceList = await this.client.getDevices();

      for (const device of deviceList.devices) {
          this.log.info(
            chalk.yellow(
              `SmartHQ Discovered device: ${device.nickname} Model: ${device.model} Type: ${device.deviceType}`
            ),
          );

        const response = await this.client.getDevice(device.deviceId);
        const deviceServices = response.services ?? [];

        const sortedServices = deviceServices.sort((a, b) => {
          if (a.serviceDeviceType < b.serviceDeviceType) return -1;
          if (a.serviceDeviceType > b.serviceDeviceType) return 1;
          return 0;
        });

        if (
          (this.config.debugServicesFridge && device.deviceType === 'cloud.smarthq.device.refrigerator') ||
          (this.config.debugServicesDishwasher && device.deviceType === 'cloud.smarthq.device.dishwasher') ||
          this.config.debugServicesAll 
        ) {
          for (const service of sortedServices) {
            this.log.info(chalk.yellow('ServiceId         = ' + service.serviceId));
            this.log.info(chalk.yellow('ServiceDeviceType = ' + service.serviceDeviceType));
            this.log.info(chalk.yellow('ServiceType       = ' + service.serviceType));
            this.log.info(chalk.yellow('Domain            = ' + service.domainType));


        try {
          const response = await this.client.getServiceDetails(
            device.deviceId,
            service.serviceId,
          );

          if (response?.state == null) {
            this.client.debug("No response from gettest command");
            return false;
          }
          this.log.info(chalk.yellow('Config            = ' + JSON.stringify(response.config, null, 2)));
        } catch (error) {
          this.client.debug("Error getting test: " + error);
          return false;
        }
          }
        }

        const accessoryType = this.getAccessoryByDeviceId(
          device,
          '',
          device.nickname, // FIX 4: remove deviceId from name
        );

        // Dishwasher group accessories
        if (device.deviceType === 'cloud.smarthq.device.dishwasher') {
          this.debug(
            'blue',
            `Creating group accessory for dishwasher modes for device ${device.nickname}`,
          );

          const groupTemperatureUuid = this.getAccessoryByDeviceId(
            device,
            `tempmodes-${device.deviceId}`, // FIX 5: template string fixed
            'Wash Temps',
          );

          const groupDryerUuid = this.getAccessoryByDeviceId(
            device,
            `drymodes-${device.deviceId}`,
            'Dry Levels',
          );

          const groupZoneUuid = this.getAccessoryByDeviceId(
            device,
            `zonemodes-${device.deviceId}`,
            'Wash Zones',
          );

          const groupPresetsUuid = this.getAccessoryByDeviceId(
            device,
            `washmodes-${device.deviceId}`,
            'Preset Modes',
          );

          this.groupAccessoryArray = [
            groupTemperatureUuid!,
            groupDryerUuid!,
            groupZoneUuid!,
            groupPresetsUuid!,
          ];
        }

        switch (device.deviceType) {
          case 'cloud.smarthq.device.refrigerator':
            this.debug('green', `Setting up Refrigerator services for ${device.nickname}`);
            setupRefrigeratorServices.call(this, accessoryType!, deviceServices, device.deviceId);
            break;

          case 'cloud.smarthq.device.dishwasher':
            this.debug('blue', `Setting up Dishwasher services for ${device.nickname}`);
            setupDishwasherServices.call(
              this,
              accessoryType!,
              deviceServices,
              device.deviceId,
              this.groupAccessoryArray,
            );
            break;

          case 'cloud.smarthq.device.airconditioner': {
            this.debug('green', `Creating group accessories for air conditioner modes and fan speeds for device ${device.nickname}`);

            const groupModesUuid = this.getAccessoryByDeviceId(
              device,
              `acmodes-${device.deviceId}`,
              'AC Mode',
            );

            const groupFanUuid = this.getAccessoryByDeviceId(
              device,
              `acfan-${device.deviceId}`,
              'AC Fan',
            );

            this.debug('green', `Setting up Air Conditioner services for ${device.nickname}`);
            const airConditioner = setupAirConditionerServices.call(
              this,
              accessoryType!,
              deviceServices,
              device.deviceId,
              [groupModesUuid!, groupFanUuid!],
            );

            if (airConditioner) {
              this.airConditioners.set(device.deviceId, airConditioner);
            }
            break;
          }

          default:
            this.debug('red', `not implemented device : for device ${device.nickname}`);
        }
      }

      const params = { after: '7d' };
      const recentAlerts = await this.client.getRecentAlerts(params);

      for (const alert of recentAlerts.alerts) {
        this.debug(
          'yellow',
          `Recent Alert at: ${alert.lastAlertTime} for device ${alert.deviceType}: ${alert.alertType}`,
        );
      }

      // =========================================================
      // CLEANUP STALE ACCESSORIES (FIXED LOGIC)
      // =========================================================
      for (const [uuid, accessory] of this.accessories) {
        if (!this.discoveredCacheUUIDs.has(uuid)) {
          this.log.info('Removing existing accessory from cache:', accessory.displayName);

          // Dispose any associated AirConditioner instance before removing the accessory
          for (const [deviceId, airConditioner] of this.airConditioners.entries()) {
            const parentUuid = this.api.hap.uuid.generate(`smarthq-${deviceId}`);
            if (parentUuid === uuid) {
              await airConditioner.dispose();
              this.airConditioners.delete(deviceId);
            }
          }

          this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
            accessory,
          ]);

          this.accessories.delete(uuid); // FIX 6: keep map in sync
        }
      }
    } finally {
      this.discovering = false;
    }
  }

  // =========================================================
  // CACHE RESTORE
  // =========================================================
  configureAccessory(accessory: PlatformAccessory) {
    this.accessories.set(accessory.UUID, accessory);
  }

  // =========================================================
  // ACCESSORY FACTORY
  // =========================================================
  getAccessoryByDeviceId(
    device: Device,
    uuidSuffix: string,
    displayName: string,
  ): PlatformAccessory | undefined {
    const uuid = !uuidSuffix
      ? this.api.hap.uuid.generate(`smarthq-${device.deviceId}`)
      : this.api.hap.uuid.generate(`smarthq-${device.deviceId}-${uuidSuffix}`);

    // FIX 7: ALWAYS record UUID immediately (prevents cleanup bugs)
    this.discoveredCacheUUIDs.add(uuid);

    const existingAccessory = this.accessories.get(uuid);

    if (existingAccessory) {
      this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);

      existingAccessory.displayName = displayName;
      existingAccessory.context.device = device;

      this.api.updatePlatformAccessories([existingAccessory]);

      return existingAccessory;
    }

    this.log.info('Adding new accessory:', displayName);

    const accessory = new this.api.platformAccessory(displayName, uuid);

    accessory.context.device = device;

    this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [
      accessory,
    ]);

    this.accessories.set(uuid, accessory);

    return accessory;
  }

  // =========================================================
  // DEBUG
  // =========================================================
  public debug(color: string, message: string) {
    if (!this.config.debugLogging) return;

    switch (color) {
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
  }
}
