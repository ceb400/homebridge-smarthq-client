import {
  API,
  CharacteristicValue,
  PlatformAccessory,
  Service,
  Characteristic,
} from "homebridge";
import { SmartHQClient, DeviceService, SendCommandRequest } from "ge-smarthq";
import { SmartHqPlatform } from "../platform.js";
import { ServiceMessage } from "../index.js";
import chalk from "chalk";

/**

 * Platform Accessory

 * An instance of this class is created for each accessory your platform registers

 * Each accessory may expose multiple services of different service types

 */

export class Dishwasher {
  private client: SmartHQClient;
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;
  private readonly api: API;
  private totalSeconds = 0;
  private timeRemainingFromWebSocket = 0;
  private energyMeterValuePerHour = 0;

  private washZoneMap = new Map<string, string>();
  private washTempMap = new Map<string, string>();
  private heatedDryMap = new Map<string, string>();
  private presetMap = new Map<string, string>();

  // Options for the set command - not directly tied to characteristics, but used to build command payload based on which options are toggled on or off

  private currentPreset: string = "cloud.smarthq.domain.dishwasher.normal";
  private currentWashTemp: string = "cloud.smarthq.type.dishwasher.washtemp.none";
  private currentWashZone: string = "cloud.smarthq.type.dishwasher.washzone.both";
  private currentHeatedDry: string = "cloud.smarthq.type.dishwasher.heateddry.none";
  private currentbottleWash = false;
  private currentSteam = false;
  private currentSilverwareWash = false;

  //========  preset mode constants  ========

  private readonly NORMAL_MODE = "cloud.smarthq.domain.dishwasher.normal";
  private readonly HEAVY_MODE = "cloud.smarthq.domain.dishwasher.heavy";
  private readonly AUTOSENSE_MODE = "cloud.smarthq.domain.dishwasher.autosense";
  private readonly ONE_HOUR_MODE = "cloud.smarthq.domain.dishwasher.timed.hours.1";
  private readonly PLATPLUS_MODE =
    "cloud.smarthq.domain.dishwasher.brand.cascade.platinumplus";
  private readonly RINSE_MODE = "cloud.smarthq.domain.dishwasher.rinse";
  private readonly CLEAN_MODE = "cloud.smarthq.domain.dishwasher.dishwasher.cleaning";
  private readonly LIGHT_MODE = "cloud.smarthq.domain.dishwasher.light";

  //========  wash zone constants  ========

  private readonly BOTH_ZONE = "cloud.smarthq.type.dishwasher.washzone.both";
  private readonly LOWER_ZONE = "cloud.smarthq.type.dishwasher.washzone.lower";
  private readonly UPPER_ZONE = "cloud.smarthq.type.dishwasher.washzone.upper";

  //========  heated dry constants  ========

  private readonly NONE_DRY = "cloud.smarthq.type.dishwasher.heateddry.none";
  private readonly MAX_DRY = "cloud.smarthq.type.dishwasher.heateddry.maxdry";
  private readonly ADDED_DRY = "cloud.smarthq.type.dishwasher.heateddry.addedheat";

  //========  wash temperature constants  ========

  private readonly NONE_TEMP = "cloud.smarthq.type.dishwasher.washtemp.none";
  private readonly BOOST_TEMP = "cloud.smarthq.type.dishwasher.washtemp.boost";
  private readonly SANI_TEMP = "cloud.smarthq.type.dishwasher.washtemp.sani";
  private readonly SANI_AND_BOOST_TEMP =
    "cloud.smarthq.type.dishwasher.washtemp.saniandboost";

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: DeviceService[],
    public readonly deviceId: string,
    private readonly groupAccessory: PlatformAccessory[],
  ) {
    this.api = platform.api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.accessory = accessory;
    this.groupAccessory = groupAccessory;
    this.deviceServices = deviceServices;
    this.deviceId = deviceId;
    this.client = new SmartHQClient({
      clientId: platform.config.clientId,
      clientSecret: platform.config.clientSecret,
      redirectUri: platform.config.redirectUri,
      debug: platform.config.debug || false,
    });

    // Check if dishwasher service is excluded from config

    if (this.platform.config.excludeDishwasherServices) {
      this.platform.log.info(
        chalk.yellow(
          `Dishwasher service is excluded from config. Clearing old UUIDs for ${this.deviceId}`,
        ),
      );

      // Clear old services from cache before returning

      this.clearOldServices(this.accessory);
      this.groupAccessory.forEach((accessory) => this.clearOldServices(accessory));
      return;
    }

    this.setupWebSocket();

    /*

     *  Listen for WebSocket messages for this device and update HomeKit characteristics accordingly

     */

    this.client.on("service_update", (message: ServiceMessage) => {
      if (
        message.domainType === "cloud.smarthq.domain.energy" &&
        message.deviceType === "cloud.smarthq.device.dishwasher"
      ) {
        this.energyMeterValuePerHour += (message.state?.meterValueDelta as number) || 0; // sum for the hour until reset
        this.client.debug(
          chalk.white("Energy Meter Value: " + this.energyMeterValuePerHour),
        );
      }

      // Update the time remaining from the WebSocket message if it is a cycle timer update
      // Update the ConfiguredName of the durationTimer service to show the time remaining in the cycle or the current time if no cycle is active

      if (
        message.serviceType === "cloud.smarthq.service.cycletimer" &&
        message.domainType === "cloud.smarthq.domain.cycle"
      ) {
        this.timeRemainingFromWebSocket =
          (message.state?.secondsRemaining as number) || 0;

        if (this.totalSeconds === 0) {
          this.totalSeconds = (message.state?.secondsRemaining as number) || 0;
        }
      }
      if (message.state?.mode != null) {
        switch (message.state.mode) {
          case this.NORMAL_MODE:
            this.handleModeGet(this.NORMAL_MODE);
            break;
          case this.HEAVY_MODE:
            this.handleModeGet(this.HEAVY_MODE);
            break;
          case this.AUTOSENSE_MODE:
            this.handleModeGet(this.AUTOSENSE_MODE);
            break;
          case this.ONE_HOUR_MODE:
            this.handleModeGet(this.ONE_HOUR_MODE);
            break;
          case this.PLATPLUS_MODE:
            this.handleModeGet(this.PLATPLUS_MODE);
            break;
          case this.RINSE_MODE:
            this.handleModeGet(this.RINSE_MODE);
            break;
          case this.CLEAN_MODE:
            this.handleModeGet(this.CLEAN_MODE);
            break;
          case this.LIGHT_MODE:
            this.handleModeGet(this.LIGHT_MODE);
            break;
          default:
            this.client.debug("Unknown mode: " + message.state.mode);
        }
      }
    });

    //=====================================================================================

    setInterval(
      () => {
        this.client.debug(chalk.red("Watts/hour value: " + this.energyMeterValuePerHour));
        this.energyMeterValuePerHour = 0;
      },
      60 * 60 * 1000,
    );

    // Interval to update configured name of durationTimer service every minute to show time remaining in cycle or current time if no cycle is active

    setInterval(() => {
      this.updateDurationTimerDisplay(this.timeRemainingFromWebSocket);
    }, 60 * 1000);

    const washTemps: [string, string][] =
      this.getAvailableItemsByType("washTempAvailable");
    const washZones: [string, string][] =
      this.getAvailableItemsByType("washZoneAvailable");
    const heatedDrys: [string, string][] =
      this.getAvailableItemsByType("heatedDryAvailable");

    const presetModes: [string, string][] = this.getAvailablePresets();

    // set accessory information

    this.accessory
      .getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, "GE")
      .setCharacteristic(
        this.Characteristic.Model,
        accessory.context.device.model || "Default-Model",
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        accessory.context.device.serial || "Default-Serial",
      );

    /*
    // create a new Valve service ------------------------------------
    */

    let displayName = "Dishwasher";

    const dishwasher =
      this.accessory.getService(displayName) ||
      this.accessory.addService(
        this.Service.Valve,
        displayName,
        `${this.deviceId}-dishwasher`,
      );
    dishwasher.setCharacteristic(this.Characteristic.Name, displayName);
    dishwasher.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    dishwasher.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    dishwasher
      .getCharacteristic(this.Characteristic.Active)
      .onGet(this.handleActiveGet.bind(this))
      .onSet(this.handleActiveSet.bind(this));

    dishwasher
      .getCharacteristic(this.Characteristic.InUse)
      .onGet(this.handleInUseGet.bind(this));

    const setDurationCharacteristic = dishwasher.getCharacteristic(
      this.Characteristic.SetDuration,
    );
    try {
      setDurationCharacteristic.setProps({
        minValue: 0,
        maxValue: 19000,
        minStep: 1,
      });
    } catch (error) {
      this.client.debug(
        `Error setting Dishwasher setduration properties: ${this.formatError(error)}`,
      );
    }
    dishwasher
      .getCharacteristic(this.Characteristic.SetDuration)
      .onGet(this.handleSetDurationGet.bind(this));

    //.onSet(this.handleSetDurationSet.bind(this));

    const remainingDurationCharacteristic = dishwasher.getCharacteristic(
      this.Characteristic.RemainingDuration,
    );
    try {
      remainingDurationCharacteristic.setProps({
        minValue: 0,
        maxValue: 19000,
        minStep: 1,
      });
    } catch (error) {
      this.client.debug(
        `Error setting Dishwasher remainingduration properties: ${this.formatError(error)}`,
      );
    }
    dishwasher
      .getCharacteristic(this.Characteristic.RemainingDuration)
      .onGet(this.handleRemainingTimeGet.bind(this));

    dishwasher
      .getCharacteristic(this.Characteristic.ValveType)
      .onGet(this.handleValveTypeGet.bind(this));

    dishwasher
      .getCharacteristic(this.Characteristic.Name)
      .onGet(this.handleNameGet.bind(this));

    // Test dynamically changing configured name to use as a text field

    const customName = "Time Display";

    const durationTimer = this.setupService(
      "Outlet",
      customName,
      `${this.deviceId}-optionstimer`,
    );

    durationTimer
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        const currentState = durationTimer.getCharacteristic(this.Characteristic.On)
          .value as boolean | false;

        return currentState; // Return true or false
      })
      .onSet((value) => {
        this.client.debug(chalk.yellow(`Time Display On/Off set to: ${value}`));
      });

    /**

     * create a new steam Outlet service Dummy (used as 'available' option)  ------

     */

    displayName = "Steam option";

    const optionSteam = this.setupService(
      "Outlet",
      displayName,
      `${this.deviceId}-optionsteam`,
    );

    optionSteam
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        const currentState = optionSteam.getCharacteristic(this.Characteristic.On)
          .value as boolean | false;

        return currentState; // Return true or false
      })
      .onSet((value) => {
        this.currentSteam = value as boolean;
        this.testSetMode({ steam: value as boolean });
      });

    /**

     * create a new bottlewash Outlet service Dummy (used as 'available' option) for extending presets ------

     */

    displayName = "Bottlewash option";

    const optionBottlewash = this.setupService(
      "Outlet",
      displayName,
      `${this.deviceId}-optionbottlewash`,
    );

    optionBottlewash
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        const currentState = optionBottlewash.getCharacteristic(this.Characteristic.On)
          .value as boolean | false;

        return currentState; // Return true or false
      })
      .onSet((value) => {
        this.currentbottleWash = value as boolean;
        this.testSetMode({ bottle: value as boolean });
      });

    /**

     * create a new silverware Outlet service Dummy (used as 'available' option) for extending presets ------

     */

    displayName = "Silverware option";

    const optionSilverware = this.setupService(
      "Outlet",
      displayName,
      `${this.deviceId}-option-silverware`,
    );

    optionSilverware
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        const currentState = optionSilverware.getCharacteristic(this.Characteristic.On)
          .value as boolean | false;

        return currentState; // Return true or false
      })
      .onSet((value) => {
        this.currentSilverwareWash = value as boolean;
        this.testSetMode({ silverware: this.currentSilverwareWash });
      });

    /**

     * Grouped services for Wash Temp, Dry Level, Wash Zone, and Preset Modes - only one can be on at a time within each group

     */

    this.client.debug(chalk.green("Wash Temperature options"));
    const temps = washTemps.map(([item]) =>
      this.setupGroupService(
        "Outlet",
        item,
        "modegroup-" + item.replace(/\s+/g, "-").toLowerCase(),
        this.groupAccessory[0],
      ),
    );

    temps.forEach((service, index) => {
      service.getCharacteristic(this.Characteristic.On).onSet((value) => {
        if (value === true) {
          switch (service.displayName) {
            case "None":
              this.currentWashTemp = this.NONE_TEMP;
              break;
            case "Boost":
              this.currentWashTemp = this.BOOST_TEMP;
              break;
            case "Sani":
              this.currentWashTemp = this.SANI_TEMP;
              break;
            case "Saniandboost":
              this.currentWashTemp = this.SANI_AND_BOOST_TEMP;
              break;
            default:
              this.currentWashTemp = this.NONE_TEMP;
          }

          // Turn others off

          temps.forEach((otherService, otherIndex) => {
            if (index !== otherIndex) {
              otherService.updateCharacteristic(this.Characteristic.On, false);
            }
          });
        } else {
          // Optional: Prevent turning off if you want "always one on" logic

          service.updateCharacteristic(this.Characteristic.On, true);
        }
        this.client.debug("Wash Temp mode set to " + this.currentWashTemp);
      });

      // Set initial state of wash temperature based on which service is currently on

      if (service.getCharacteristic(this.Characteristic.On).value === true) {
        switch (service.displayName) {
          case "None":
            this.currentWashTemp = this.NONE_TEMP;
            break;
          case "Boost":
            this.currentWashTemp = this.BOOST_TEMP;
            break;
          case "Sani":
            this.currentWashTemp = this.SANI_TEMP;
            break;
          case "Saniandboost":
            this.currentWashTemp = this.SANI_AND_BOOST_TEMP;
            break;
          default:
            this.currentWashTemp = this.NONE_TEMP;
        }
        this.client.debug("Initial Wash Temperature set to " + this.currentWashTemp);
      }
    });

    this.client.debug(chalk.green("Dry Mode options"));

    const drymodes = heatedDrys.map(([item]) =>
      this.setupGroupService(
        "Outlet",
        item,
        "modegroup-" + item.replace(/\s+/g, "-").toLowerCase(),
        this.groupAccessory[1],
      ),
    );

    drymodes.forEach((service, index) => {
      service.getCharacteristic(this.Characteristic.On).onSet((value) => {
        if (value === true) {
          switch (service.displayName) {
            case "None":
              this.currentHeatedDry = this.NONE_DRY;
              break;
            case "Addedheat":
              this.currentHeatedDry = this.ADDED_DRY;
              break;
            case "Maxdry":
              this.currentHeatedDry = this.MAX_DRY;
              break;
            default:
              this.currentHeatedDry = this.NONE_DRY;
          }

          // Turn others off

          drymodes.forEach((otherService, otherIndex) => {
            if (index !== otherIndex) {
              otherService.updateCharacteristic(this.Characteristic.On, false);
            }
          });
        } else {
          // Optional: Prevent turning off if you want "always one on" logic

          service.updateCharacteristic(this.Characteristic.On, true);
        }
        this.client.debug("Dry Temp mode set to " + this.currentHeatedDry);
      });

      // Set initial state of currentHeatedDry based on which service is currently on

      if (service.getCharacteristic(this.Characteristic.On).value === true) {
        switch (service.displayName) {
          case "None":
            this.currentHeatedDry = this.NONE_DRY;
            break;
          case "Addedheat":
            this.currentHeatedDry = this.ADDED_DRY;
            break;
          case "Maxdry":
            this.currentHeatedDry = this.MAX_DRY;
            break;
          default:
            this.currentHeatedDry = this.NONE_DRY;
        }
        this.client.debug("Initial Heated Dry set to " + this.currentHeatedDry);
      }
    });

    this.client.debug(chalk.green("Wash Zone Modes options"));

    const zones = washZones.map(([item]) =>
      this.setupGroupService(
        "Outlet",
        item,
        "modegroup-" + item.replace(/\s+/g, "-").toLowerCase(),
        this.groupAccessory[2],
      ),
    );

    zones.forEach((service, index) => {
      service.getCharacteristic(this.Characteristic.On).onSet((value) => {
        if (value === true) {
          switch (service.displayName) {
            case "Both":
              this.currentWashZone = this.BOTH_ZONE;
              break;
            case "Lower":
              this.currentWashZone = this.LOWER_ZONE;
              break;
            case "Upper":
              this.currentWashZone = this.UPPER_ZONE;
              break;
            default:
              this.currentWashZone = this.BOTH_ZONE;
          }
          this.client.debug("Setting Wash Zone to " + this.currentWashZone);

          // Turn others off

          zones.forEach((otherService, otherIndex) => {
            if (index !== otherIndex) {
              otherService.updateCharacteristic(this.Characteristic.On, false);
            }
          });
        } else {
          // Optional: Prevent turning off if you want "always one on" logic

          service.updateCharacteristic(this.Characteristic.On, true);
        }
        this.client.debug("Wash Zone mode set to " + this.currentWashZone);
      });

      // Set initial state of currentWashZone based on which service is currently on

      if (service.getCharacteristic(this.Characteristic.On).value === true) {
        switch (service.displayName) {
          case "Both":
            this.currentWashZone = this.BOTH_ZONE;
            break;
          case "Lower":
            this.currentWashZone = this.LOWER_ZONE;
            break;
          case "Upper":
            this.currentWashZone = this.UPPER_ZONE;
            break;
          default:
            this.currentWashZone = this.BOTH_ZONE;
        }

        this.client.debug("Initial Wash Zone set to " + this.currentWashZone);
      }
    });

    this.client.debug(chalk.green("Preset Mode options"));

    const presets = presetModes.map(([item]) =>
      this.setupGroupService(
        "Outlet",
        item,
        "modegroup-" + item.replace(/\s+/g, "-").toLowerCase(),
        this.groupAccessory[3],
      ),
    );

    presets.forEach((service, index) => {
      service.getCharacteristic(this.Characteristic.On).onSet((value) => {
        if (value === true) {
          switch (service.displayName) {
            case "Normal":
              this.currentPreset = this.NORMAL_MODE;
              break;
            case "Heavy":
              this.currentPreset = this.HEAVY_MODE;
              break;
            case "AutoSense":
              this.currentPreset = this.AUTOSENSE_MODE;
              break;
            case "Rinse":
              this.currentPreset = this.RINSE_MODE;
              break;
            case "Platinumplus":
              this.currentPreset = this.PLATPLUS_MODE;
              break;
            case "Light":
              this.currentPreset = this.LIGHT_MODE;
              break;
            case "Cleaning":
              this.currentPreset = this.CLEAN_MODE;
              break;
            case "1 Hour":
              this.currentPreset = this.ONE_HOUR_MODE;
              break;
            default:
              this.currentPreset = this.NORMAL_MODE;
          }
          this.client.debug("Setting Preset Mode to " + this.currentPreset);

          // Turn others off

          presets.forEach((otherService, otherIndex) => {
            if (index !== otherIndex) {
              otherService.updateCharacteristic(this.Characteristic.On, false);
            }
          });
        }
      });

      // Set initial state of currentPreset based on which service is currently on

      if (service.getCharacteristic(this.Characteristic.On).value === true) {
        switch (service.displayName) {
          case "Normal":
            this.currentPreset = this.NORMAL_MODE;
            break;
          case "Heavy":
            this.currentPreset = this.HEAVY_MODE;
            break;
          case "AutoSense":
            this.currentPreset = this.AUTOSENSE_MODE;
            break;
          case "Rinse":
            this.currentPreset = this.RINSE_MODE;
            break;
          case "Platinumplus":
            this.currentPreset = this.PLATPLUS_MODE;
            break;
          case "Light":
            this.currentPreset = this.LIGHT_MODE;
            break;
          case "Cleaning":
            this.currentPreset = this.CLEAN_MODE;
            break;
          case "1 Hour":
            this.currentPreset = this.ONE_HOUR_MODE;
            break;
          default:
            this.currentPreset = this.NORMAL_MODE;
        }
        this.client.debug("Initial Preset Mode set to " + this.currentPreset);
      }
    });

    // NOTE:  only for developing a method for testing command combinations.

    // this.testCases();

    /*

    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.state.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher"
      ) {
        try {
          const response = await this.client.getServiceDetails(
            this.deviceId,
            service.serviceId,
          );
          if (response?.state == null) {
            this.client.debug("No response from dishwasher state request");
            break;
          }
        } catch (error) {
          this.client.debug(`Dishwasher state request failed: ${this.formatError(error)}`);
          break;
        }

        //const originalPresetMode = response?.state.

      }
    }

      */
  }

  /**

   * Handle requests to get the current value of the "Active" characteristic

   */

  async handleSetDurationGet(): Promise<CharacteristicValue> {
    return this.totalSeconds;
  }

  /**

   * Handle requests to get the current value of the "Active" characteristic

   */

  async handleActiveGet(): Promise<CharacteristicValue> {
    let isActive = false;
    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.state.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher"
      ) {
        try {
          const response = await this.client.getServiceDetails(
            this.deviceId,
            service.serviceId,
          );
          if (response?.state == null) {
            this.client.debug("No response from dishwasher run status request");
            return false;
          }

          if (
            response.state.runStatus === "cloud.smarthq.type.runstatus.endofcycle" ||
            response.state.runStatus === "cloud.smarthq.type.runstatus.off"
          ) {
            // change back to 0 seconds remaining when cycle is not active to prevent stale remaining time value in HomeKit

            this.totalSeconds = 0; // reset total seconds when cycle is complete
            this.updateDurationTimerDisplay(this.totalSeconds);
          } else {
            isActive = true;
            this.accessory
              .getService("Dishwasher")
              ?.getCharacteristic(this.Characteristic.RemainingDuration)
              .updateValue(await this.handleRemainingTimeGet());
            this.accessory
              .getService("Dishwasher")
              ?.getCharacteristic(this.Characteristic.InUse)
              .updateValue(this.Characteristic.InUse.IN_USE);
          }
          break;
        } catch (error) {
          this.client.debug(
            `Dishwasher run status request failed: ${this.formatError(error)}`,
          );
          return isActive;
        }
      }
    }
    return isActive;
  }

  /**

   * Handle requests to set the "Active" characteristic

   */

  async handleActiveSet(value: CharacteristicValue) {
    this.client.debug(`Starting dishwasher active state: ${value}`);
    if (value) {
      const setModeResp = await this.setMode();
      if (!setModeResp) {
        this.client.debug("setMode failed; not starting cycle");
        return;
      }
      this.platform.log.info(chalk.green("Starting dishwasher cycle with options:"));
      this.platform.log.info(chalk.green(`Preset   : ${this.currentPreset}`));
      this.platform.log.info(chalk.green(`Wash Temp: ${this.currentWashTemp}`));
      this.platform.log.info(chalk.green(`Wash Zone: ${this.currentWashZone}`));
      this.platform.log.info(chalk.green(`Heat Dry : ${this.currentHeatedDry}`));
      this.platform.log.info(chalk.green(`Bottle Wash : ${this.currentbottleWash}`));
      this.platform.log.info(chalk.green(`Steam Option: ${this.currentSteam}`));
      const startResp = await this.startCycle();
      if (!startResp) {
        this.client.debug("Failed to start cycle");
        return;
      }
    } else {
      await this.stopCycle();
    }
  }

  /**

   * Handle requests to get the current value of the "In Use" characteristic

   */

  async handleInUseGet(): Promise<CharacteristicValue> {
    //this.client.debug('Triggered GET InUse');

    // set this to a valid value for InUse

    //const currentValue = this.Characteristic.InUse.IN_USE;

    return this.handleActiveGet();
  }

  /**

   * Handle requests to get the current value of the "Name" characteristic

   */

  async handleNameGet() {
    //this.client.debug('Triggered GET Name');

    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.state.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher"
      ) {
        try {
          const response = await this.client.getServiceDetails(
            this.deviceId,
            service.serviceId,
          );
          if (response?.state == null) {
            this.client.debug("No response from dishwasher name request");
            return false;
          }

          //this.client.debug('Dishwasher state response: ' + JSON.stringify(response, null, 2));

          break;
        } catch (error) {
          this.client.debug(`Dishwasher name request failed: ${this.formatError(error)}`);
          return false;
        }
      }
    }
    return this.accessory.displayName;
  }

  /**

   * Handle requests to get the current value of the "mode" value

   */

  async handleModeGet(v1mode: string): Promise<CharacteristicValue> {
    let isOn = false;

    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.state.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher"
      ) {
        try {
          const response = await this.client.getServiceDetails(
            this.deviceId,
            service.serviceId,
          );

          /*

          this.client.debug(
            "================ Response from getServiceDetails for mode get: " +
              JSON.stringify(response, null, 2),
          );

          */

          if (response?.state?.mode == null) {
            this.client.debug("No response from dishwasher mode request");
            return false;
          }
          isOn = response?.state?.mode === v1mode;
          break;
        } catch (error) {
          this.client.debug(`Dishwasher mode request failed: ${this.formatError(error)}`);
          return false;
        }
      }
    }

    return isOn;
  }

  /**

   * Handle requests to get the current value of the "Valve Type" characteristic

   */

  async handleValveTypeGet() {
    //this.client.debug('Triggered GET ValveType');

    // set this to a valid value for ValveType

    const currentValue = this.Characteristic.ValveType.GENERIC_VALVE;

    return currentValue;
  }

  async handleRemainingTimeGet(): Promise<CharacteristicValue> {
    // Note: this service does not provide remaining time of an active cycle. The value appears to be the total cycle time and does not change as the cycle progresses

    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.cycletimer" &&
        service.domainType === "cloud.smarthq.domain.cycle"
      ) {
        this.totalSeconds = (service.state?.secondsRemaining as number) || 0;
        break;
      }
    }
    return this.totalSeconds;
  }

  async setMode() {
    const baseCommand = {
      deviceId: this.deviceId,
      kind: "service#command",
      serviceDeviceType: "cloud.smarthq.device.dishwasher",
      serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
    };

    let cmdBody: SendCommandRequest;

    switch (this.currentPreset) {
      case this.NORMAL_MODE:
      case this.HEAVY_MODE:
      case this.AUTOSENSE_MODE:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washTemp: this.currentWashTemp,
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            steam: this.currentSteam,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
        break;

      case this.PLATPLUS_MODE:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washTemp: this.currentWashTemp,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            steam: this.currentSteam,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
        break;

      case this.RINSE_MODE:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washZone: this.currentWashZone,
            bottleWash: this.currentbottleWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
        break;

      case this.CLEAN_MODE:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washTemp: this.currentWashTemp,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
        break;

      case this.ONE_HOUR_MODE:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
        break;
      default:
        cmdBody = {
          ...baseCommand,
          domainType: this.currentPreset,
          command: {
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
        };
    }

    try {
      const response = await this.client.sendCommand(cmdBody);

      if (response == null) {
        this.client.debug("No response from setMode command");
        return false;
      }

      return !!response.success;
    } catch (error: unknown) {
      this.platform.log.warn(`setMode command failed: ${this.formatError(error)}`);
      return false;
    }
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.stack ?? `${error.name}: ${error.message}`;
    }
    if (typeof error === "string") {
      return error;
    }
    if (error && typeof error === "object") {
      const objectError = error as Record<string, unknown>;
      const entries = Object.entries(objectError).filter(
        ([, value]) => value !== undefined,
      );
      if (entries.length > 0) {
        try {
          return JSON.stringify(Object.fromEntries(entries), null, 2);
        } catch {
          return String(error);
        }
      }
    }
    try {
      return JSON.stringify(error, null, 2);
    } catch {
      return String(error);
    }
  }

  async startCycle() {
    const cmdBody = {
      command: {
        commandType: "cloud.smarthq.command.dishwasher.state.v1.start",
      },
      deviceId: this.deviceId,
      domainType: "cloud.smarthq.domain.dishwasher",
      kind: "service#command",
      serviceDeviceType: "cloud.smarthq.device.dishwasher",
      serviceType: "cloud.smarthq.service.dishwasher.state.v1",
    };
    try {
      const response = await this.client.sendCommand(cmdBody); // This command starts the cycle

      if (response == null) {
        this.client.debug("No response from startCycle command");
        return false;
      } else {
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.InUse)
          .updateValue(this.Characteristic.InUse.IN_USE);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.SetDuration)
          .updateValue(this.totalSeconds);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.RemainingDuration)
          .updateValue(this.timeRemainingFromWebSocket);
        return response.success;
      }
    } catch (error) {
      this.platform.log.warn(`startCycle command failed: ${this.formatError(error)}`);
      return false;
    }
  }

  async stopCycle() {
    const cmdBody = {
      command: {
        commandType: "cloud.smarthq.command.dishwasher.state.v1.stop",
      },
      deviceId: this.deviceId,
      domainType: "cloud.smarthq.domain.dishwasher",
      kind: "service#command",
      serviceDeviceType: "cloud.smarthq.device.dishwasher",
      serviceType: "cloud.smarthq.service.dishwasher.state.v1",
    };
    try {
      const response = await this.client.sendCommand(cmdBody); // This command stops the cycle

      if (response == null) {
        this.client.debug("No response from stopCycle command");
        return false;
      } else {
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.InUse)
          .updateValue(this.Characteristic.InUse.NOT_IN_USE);
        this.totalSeconds = 0; // reset total seconds when cycle is stopped
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.SetDuration)
          .updateValue(this.totalSeconds);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.RemainingDuration)
          .updateValue(this.timeRemainingFromWebSocket);
        return response.success;
      }
    } catch (error) {
      this.platform.log.warn(`stopCycle command failed: ${this.formatError(error)}`);
      return false;
    }
  }

  setupService(serviceType: string, displayName: string, serviceIdSuffix: string) {
    let service: Service;

    switch (serviceType) {
      case "Outlet":
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Outlet, displayName, serviceIdSuffix);
        break;

      case "Switch":
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Switch, displayName, serviceIdSuffix);
        break;

      default:
        this.client.debug("Unknown service type: " + serviceType + "");
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Fan, displayName, serviceIdSuffix);
    }

    service.setCharacteristic(this.Characteristic.Name, displayName);
    service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    return service;
  }

  setupGroupService(
    serviceType: string,
    displayName: string,
    serviceIdSuffix: string,
    accessory: PlatformAccessory,
  ) {
    let service: Service;

    if (displayName === "1") {
      displayName = "1 Hour";
    }
    this.client.debug(chalk.blue("Setting up  " + serviceType + " for " + displayName));

    switch (serviceType) {
      case "Outlet":
        service =
          accessory.getService(displayName) ||
          accessory.addService(this.Service.Outlet, displayName, serviceIdSuffix);
        break;

      case "Switch":
        service =
          accessory.getService(displayName) ||
          accessory.addService(this.Service.Switch, displayName, serviceIdSuffix);
        break;

      default:
        this.client.debug("Unknown service type: " + serviceType + "");
        service =
          accessory.getService(displayName) ||
          accessory.addService(this.Service.Fan, displayName, serviceIdSuffix);
    }

    service.setCharacteristic(this.Characteristic.Name, displayName);
    service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    return service;
  }

  /**
   * Remove all old services from cache (except AccessoryInformation)
   * This clears old UUIDs and prevents service conflicts when recreating services
   */

  clearOldServices(accessory: PlatformAccessory) {
    const servicesToRemove: Service[] = [];

    // Collect all services except AccessoryInformation

    for (const service of accessory.services) {
      if (service.UUID !== this.Service.AccessoryInformation.UUID) {
        servicesToRemove.push(service);
      }
    }

    // Remove the collected services

    servicesToRemove.forEach((service) => {
      this.client.debug(chalk.yellow(`Removing cached service: ${service.displayName}`));
      accessory.removeService(service);
    });
  }

  // Build a list of available dishwasher option names in a display-friendly format.

  getAvailableItemsByType(availableType: string): [string, string][] {
    let itemsAvailable: string[] = [];

    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.mode.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher.normal"
      ) {
        switch (availableType) {
          case "washTempAvailable":
            itemsAvailable = (service.config?.washTempAvailable as string[]) || [];
            break;
          case "washZoneAvailable":
            itemsAvailable = (service.config?.washZoneAvailable as string[]) || [];
            break;
          case "heatedDryAvailable":
            itemsAvailable = (service.config?.heatedDryAvailable as string[]) || [];
            break;
          default:
            this.client.debug("Unknown available type: " + availableType);
        }
        this.currentbottleWash = (service.state?.bottleWash as boolean) || false;
        this.currentSilverwareWash = (service.state?.silverwarewash as boolean) || false;
        this.currentSteam = (service.state?.silverwarewash as boolean) || false;
        const itemNames: Array<[string, string]> = itemsAvailable.map((item) =>
          this.getLastElementAndCapitalize(item, "."),
        );
        return itemNames;
      }
    }
    return []; // Ensure we always return an array to satisfy the expected return type
  }
  getAvailablePresets(): [string, string][] {
    const itemsAvailable: string[] = [];
    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.mode.v1" &&
        service.domainType.includes("cloud.smarthq.domain.dishwasher.")
      ) {
        const [presetMode] = this.getLastElementAndCapitalize(service.domainType, ".");
        itemsAvailable.push(presetMode);
      }
    }
    const itemNames: Array<[string, string]> = itemsAvailable.map((item) =>
      this.getLastElementAndCapitalize(item, "."),
    );
    return itemNames;
  }

  getLastElementAndCapitalize(str: string, delimiter: string): [string, string] {
    const arr = str.split(delimiter);

    // Handle cases where the delimiter might produce an empty string at the end

    const lastElement = arr.at(-1) || arr[arr.length - 1] || "";

    if (!lastElement) {
      return ["", str]; // return tuple consistently
    }

    // 2. Get the first character and convert it to uppercase

    const firstChar = lastElement.charAt(0).toUpperCase();

    // 3. Get the rest of the string from the second character onwards

    const restOfString = lastElement.slice(1);

    // 4. Concatenate the capitalized first character with the rest of the string

    const capitalizedString = firstChar + restOfString;

    switch (true) {
      case str.includes("washzone"):
        this.washZoneMap.set(capitalizedString, str);
        break;
      case str.includes("washtemp"):
        this.washTempMap.set(capitalizedString, str);
        break;
      case str.includes("heateddry"):
        this.heatedDryMap.set(capitalizedString, str);
        break;
      case str.includes("domain.dishwasher."):
        this.presetMap.set(capitalizedString, str);
        break;
      default:
    }

    return [capitalizedString, str];
  }

  async setupWebSocket() {
    try {
      await this.client.connect();
    } catch (error) {
      this.platform.log.warn(
        `Failed to connect to SmartHQ WebSocket during platform initialization: ${this.formatError(error)}`,
      );
    }
  }

  logCurrentOptions() {
    this.client.debug(chalk.yellow("Current selected options - "));
    this.client.debug(chalk.red(" Preset  : " + this.currentPreset));
    this.client.debug(chalk.red(" Temp    : " + this.currentWashTemp));
    this.client.debug(chalk.red(" Zone    : " + this.currentWashZone));
    this.client.debug(chalk.red(" Dry     : " + this.currentHeatedDry));
    this.client.debug(chalk.red("Bottle Wash:     " + this.currentbottleWash));
    this.client.debug(chalk.red("Steam:           " + this.currentSteam));
    this.client.debug(chalk.red("Silverware Wash: " + this.currentSilverwareWash));
  }

  updateDurationTimerDisplay(remainingSeconds: number) {
    const now = new Date();
    const hours = now.getHours();
    const minutes = now.getMinutes();

    if (remainingSeconds > 0) {
      const remainingHours = Math.floor(remainingSeconds / 3600);
      const remainingMinutes = Math.floor((remainingSeconds % 3600) / 60);
      const displayString = `Ends in: ${remainingHours.toString().padStart(2, "0")}:${remainingMinutes.toString().padStart(2, "0")}`;

      this.accessory
        .getService("Time Display")
        ?.getCharacteristic(this.Characteristic.ConfiguredName)
        .updateValue(displayString);
      this.accessory
        .getService("Time Display")
        ?.getCharacteristic(this.Characteristic.On)
        .updateValue(false);
      return;
    }

    const displayString = `Time: ${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}`;

    // when secondsRemaining is 0 then reset totalSeconds to prevent stale values from previous cycles

    this.totalSeconds = 0;

    this.accessory
      .getService("Dishwasher")
      ?.getCharacteristic(this.Characteristic.SetDuration)
      .updateValue(0);
    this.accessory
      .getService("Dishwasher")
      ?.getCharacteristic(this.Characteristic.RemainingDuration)
      .updateValue(0);
    this.accessory
      .getService("Dishwasher")
      ?.getCharacteristic(this.Characteristic.Active)
      .updateValue(this.Characteristic.Active.INACTIVE);
    this.accessory
      .getService("Dishwasher")
      ?.getCharacteristic(this.Characteristic.InUse)
      .updateValue(this.Characteristic.InUse.NOT_IN_USE);
    this.accessory
      .getService("Time Display")
      ?.getCharacteristic(this.Characteristic.ConfiguredName)
      .updateValue(displayString);
    this.accessory
      .getService("Time Display")
      ?.getCharacteristic(this.Characteristic.On)
      .updateValue(false);
  }

  async testCases() {
    //======================================================

    // Develop test plan for dishwasher

    //    1. save current state info to restore following test

    //.   2. for each preset mode:

    //       a. set the mode and record result of command

    //       b. for each water temp

    //          1. set the water temp and record result of command

    //.      c. delay for 5 sec interval

    //    3. restore values to original state

    //======================================================

    let originalMode: string;
    let originalWashTemp: string;
    let modesAvailable: [string] = [""];
    const washTempBase = "cloud.smarthq.type.dishwasher.washtemp.";

    //const modes = ['Heavy', 'AutoSense', 'Normal'];

    const temp = ["none", "boost", "sani", "saniandboost"];
    this.client.debug(" ## Start Test cases ##");
    this.client.debug(" ##     Save current device configuration ##");
    for (const service of this.deviceServices) {
      if (
        service.serviceDeviceType === "cloud.smarthq.device.dishwasher" &&
        service.serviceType === "cloud.smarthq.service.dishwasher.state.v1" &&
        service.domainType === "cloud.smarthq.domain.dishwasher"
      ) {
        try {
          const response = await this.client.getServiceDetails(
            this.deviceId,
            service.serviceId,
          );
          if (response?.state == null) {
            this.client.debug("No response from dishwasher test state request");
            return;
          }
          this.client.debug(JSON.stringify(response, null, 2));

          originalMode = response?.state.mode as string;
          originalWashTemp = response?.state.washTemp as string;

          modesAvailable = response?.config?.regularModeAvailable as [string];

          this.client.debug("---------------------------------------------------------");
          this.client.debug(
            chalk.green(
              `Pre test state = mode:${originalMode}  washTemp:${originalWashTemp}`,
            ),
          );
          this.client.debug("---------------------------------------------------------");
        } catch (error) {
          this.client.debug(
            `Dishwasher test state request failed: ${this.formatError(error)}`,
          );
          return;
        }

        //const originalPresetMode = response?.state.
      }
    }
    for (const mode of modesAvailable) {
      try {
        const response = await this.testSetMode({ mode: mode });
        if (response === true) {
          this.client.debug(
            chalk.green(
              ` ##     Setting mode to ${mode} ##  Outcome: ${chalk.greenBright("Valid")}`,
            ),
          );
        } else {
          this.client.debug(
            chalk.green(
              ` ##     Setting mode to ${mode} ##  Outcome: ${chalk.red("Invalid command")}`,
            ),
          );
        }
        for (const waterTemp of temp) {
          this.client.debug(
            chalk.greenBright(
              ` ##         Setting temp to ${washTempBase}${waterTemp} ##`,
            ),
          );
          await new Promise((resolve) => setTimeout(resolve, 4000));
        }
      } catch (error) {
        this.platform.log.warn(`testSetMode command failed: ${this.formatError(error)}`);
        return false;
      }
    }

    this.client.debug(" ##     Restore original device configuration ##");
  }

  async testSetMode({
    mode,
    temp,
    dry,
    zone,
    bottle,
    steam,
    silverware,
  }: {
    mode?: string;
    temp?: string;
    dry?: string;
    zone?: string;
    bottle?: boolean;
    steam?: boolean;
    silverware?: boolean;
  }) {
    const cmdBody = {
      command: {
        washTemp: temp || this.currentWashTemp,
        heatedDry: dry || this.currentHeatedDry,
        washZone: zone || this.currentWashZone,
        bottleWash: bottle || this.currentbottleWash,
        steam: steam || this.currentSteam,
        silverwareWash: silverware || this.currentSilverwareWash,
        commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
      },
      deviceId: this.deviceId,
      domainType: mode || this.currentPreset,
      kind: "service#command",
      serviceDeviceType: "cloud.smarthq.device.dishwasher",
      serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
    };

    try {
      const response = await this.client.sendCommand(cmdBody); // This command sets the mode and options

      if (response == null) {
        this.client.debug("No response from setMode command");
        return false;
      }
      this.client.debug(`Set mode ${mode} outcome: ${response.success}`);
      return response.success;
    } catch (error) {
      this.platform.log.warn(`testSetMode command failed: ${this.formatError(error)}`);
      return false;
    }
  }
}
