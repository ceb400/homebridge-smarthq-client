import {
  API,
  CharacteristicValue,
  PlatformAccessory,
  Service,
  Characteristic,
} from "homebridge";
import { SmartHQClient, DeviceService } from "ge-smarthq";
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
      debug: platform.config.debugLogging || false,
    });

    this.setupWebSocket();

    /*
     *  Listen for WebSocket messages for this device and update HomeKit characteristics accordingly
     */
    this.client.on("service_update", (message: ServiceMessage) => {
      //this.client.debug(chalk.red('Wash Modes - Service Update:'+ JSON.stringify(message, null, 2)));
      if (message.domainType === "cloud.smarthq.domain.energy" && message.deviceType === "cloud.smarthq.device.dishwasher") {
        this.client.debug('Interval Estimated energy for ' + message.deviceType + ' = ' + message.state?.meterValueDelta);
        this.energyMeterValuePerHour += (message.state?.meterValueDelta as number) || 0; // sum for the hour until reset
      }

      if (
        message.serviceType === "cloud.smarthq.service.cycletimer" &&
        message.domainType === "cloud.smarthq.domain.cycle"
      ) {
        // when secondsRemaining is 0 then reset totalSeconds to prevent stale values from previous cycles
        if (message.state?.secondsRemaining === 0) {
          this.totalSeconds = 0;
        }

        if (this.totalSeconds === 0) {
          this.totalSeconds = (message.state?.secondsRemaining as number) || 0;
        }
        this.timeRemainingFromWebSocket =
          (message.state?.secondsRemaining as number) || 0;
        this.client.debug(
          "Wash Modes - Seconds remaining from WebSocket: " +
            this.timeRemainingFromWebSocket +
            " Total seconds: " +
            this.totalSeconds,
        );
        this.getCyclePct();
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
          default:
            this.client.debug("Unknown mode: " + message.state.mode);
        }
      }
    });

    //=====================================================================================
    setInterval(
      () => {
        this.client.debug(
          chalk.red("Resetting hourly value: " + this.energyMeterValuePerHour),
        );
        this.energyMeterValuePerHour = 0;
      },
      60 * 60 * 1000,
    );

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
      this.accessory.addService(this.Service.Valve, displayName, "dishwashher-123");
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
      this.client.debug("Error setting Dishwasher setduration properties: " + error);
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
        "Error setting Dishwasher remainingduration properties: " + error,
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

    //=====================================================================================
    // create a new Lightbulb service for the Cycle % Done
    //=====================================================================================
    displayName = "Cycle % Done";
    const cyclePct =
      this.accessory.getService(displayName) ||
      this.accessory.addService(this.Service.Lightbulb, displayName, "cycle-done-2");

    cyclePct.setCharacteristic(this.Characteristic.Name, displayName);
    cyclePct.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    cyclePct.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    cyclePct
      .getCharacteristic(this.Characteristic.Brightness)
      .onGet(this.getCyclePct.bind(this))
      .onSet(this.setCyclePct.bind(this));

    /**
     * create a new steam Outlet service Dummy (used as 'available' option)  ------
     */
    displayName = "Steam option";

    const optionSteam = this.setupService("Outlet", displayName, "optionsteam-223");

    optionSteam
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        const currentState = optionSteam.getCharacteristic(this.Characteristic.On)
          .value as boolean | false;

        return currentState; // Return true or false
      })
      .onSet((value) => {
        this.currentSteam = value as boolean;
        this.client.debug("Setting Steam option to " + value);
      });

    /**
     * create a new bottlewash Outlet service Dummy (used as 'available' option) for extending presets ------
     */
    displayName = "Bottlewash option";

    const optionBottlewash = this.setupService(
      "Outlet",
      displayName,
      "optionbottlewash-223",
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
        this.client.debug("Setting Bottlewash option to " + value);
      });

    /**
     * create a new silverware Outlet service Dummy (used as 'available' option) for extending presets ------
     */
    displayName = "Silverware option";

    const optionSilverware = this.setupService(
      "Outlet",
      displayName,
      "optionsilverwarewash-223",
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
        this.client.debug("Setting Silverware option to " + value);
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
        this.client.debug(
          "Wash Temp mode " +
            service.displayName +
            " set to " +
            this.washTempMap.get(service.displayName),
        );

        if (value === true) {
          this.currentWashTemp = this.washTempMap.get(service.displayName) || "";
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
      });
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
        this.client.debug(
          "Dry Temp mode " +
            service.displayName +
            " set to " +
            this.heatedDryMap.get(service.displayName),
        );

        if (value === true) {
          this.currentHeatedDry = this.heatedDryMap.get(service.displayName) || "";
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
      });
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
        this.client.debug(
          "Wash Zone mode " +
            service.displayName +
            " set to " +
            this.washZoneMap.get(service.displayName),
        );

        if (value === true) {
          this.currentWashZone = this.washZoneMap.get(service.displayName) || "";
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
      });
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
          this.currentPreset = this.presetMap.get(service.displayName) || "";
          this.logCurrentOptions();
          // Turn others off
          presets.forEach((otherService, otherIndex) => {
            if (index !== otherIndex) {
              otherService.updateCharacteristic(this.Characteristic.On, false);
            }
          });
          this.client.debug("Setting Preset Mode to " + service.displayName);
        } else {
          // Optional: Prevent turning off if you want "always one on" logic
          service.updateCharacteristic(this.Characteristic.On, true);
        }
      });
    });
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
            this.client.debug("No response from getrunstatus command");
            return false;
          }
          if (response.state.runStatus !== "cloud.smarthq.type.runstatus.active") {
            // change back to 0 seconds remaining when cycle is not active to prevent stale remaining time value in HomeKit
            this.totalSeconds = 0; // reset total seconds when cycle is complete
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
              ?.getCharacteristic(this.Characteristic.InUse)
              .updateValue(false);
          } else {
            isActive = true;
            this.accessory
              .getService("Dishwasher")
              ?.getCharacteristic(this.Characteristic.RemainingDuration)
              .updateValue(await this.handleRemainingTimeGet());
            this.accessory
              .getService("Dishwasher")
              ?.getCharacteristic(this.Characteristic.InUse)
              .updateValue(isActive);
          }
          break;
        } catch (error) {
          this.client.debug("Error getting test: " + error);
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
    this.client.debug("== Starting:" + value);
    if (value) {
      const setModeResp = await this.setMode();
      if (!setModeResp) {
        this.client.debug("Failed to set mode, not starting cycle");
        return;
      }
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
            this.client.debug("No response from gettest command");
            return false;
          }
          //this.client.debug('Dishwasher state response: ' + JSON.stringify(response, null, 2));
          break;
        } catch (error) {
          this.client.debug("Error getting test: " + error);
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
          this.client.debug(
            "================ Response from getServiceDetails for mode get: " +
              JSON.stringify(response, null, 2),
          );
          if (response?.state?.mode == null) {
            this.client.debug("No response from getmodenormal command");
            return false;
          }
          isOn = response?.state?.mode === v1mode;
          break;
        } catch (error) {
          this.client.debug("Error getting test: " + error);
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

  async getCyclePct(): Promise<CharacteristicValue> {
    // remaining time appears able to change after a cycle has started???
    if (this.timeRemainingFromWebSocket > this.totalSeconds) {
      this.totalSeconds = this.timeRemainingFromWebSocket;
    }
    const pctDone =
      100 - Math.round((this.timeRemainingFromWebSocket / this.totalSeconds) * 100) || 0;
    this.client.debug("Wash Modes - Calculated Cycle % Done: " + pctDone + "%");
    if (this.timeRemainingFromWebSocket === 0) {
      this.accessory
        .getService("Cycle % Done")
        ?.getCharacteristic(this.Characteristic.On)
        .updateValue(false);
    } else {
      this.accessory
        .getService("Cycle % Done")
        ?.getCharacteristic(this.Characteristic.On)
        .updateValue(true);
      this.accessory
        .getService("Cycle % Done")
        ?.getCharacteristic(this.Characteristic.Brightness)
        .updateValue(pctDone);
    }
    return pctDone;
  }

  async setCyclePct(value: CharacteristicValue) {
    // not writable from HomeKit, so no implementation needed, but must be defined to prevent errors
    return value;
  }

  async setMode() {
    let cmdBody;
    let validCommand = false;

    switch (this.currentPreset) {
      case this.NORMAL_MODE:
      case this.HEAVY_MODE:
      case this.AUTOSENSE_MODE:
        cmdBody = {
          command: {
            washTemp: this.currentWashTemp,
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            steam: this.currentSteam,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
          deviceId: this.deviceId,
          domainType: this.currentPreset,
          kind: "service#command",
          serviceDeviceType: "cloud.smarthq.device.dishwasher",
          serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
        };
        validCommand = true;

        break;
      case this.PLATPLUS_MODE:
        cmdBody = {
          command: {
            washTemp: this.currentWashTemp,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            steam: this.currentSteam,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
          deviceId: this.deviceId,
          domainType: this.currentPreset,
          kind: "service#command",
          serviceDeviceType: "cloud.smarthq.device.dishwasher",
          serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
        };
        validCommand = true;

        break;
      case this.RINSE_MODE:
        cmdBody = {
          command: {
            washZone: this.currentWashZone,
            bottleWash: this.currentbottleWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
          deviceId: this.deviceId,
          domainType: this.currentPreset,
          kind: "service#command",
          serviceDeviceType: "cloud.smarthq.device.dishwasher",
          serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
        };
        validCommand = true;

        break;
      case this.ONE_HOUR_MODE:
        cmdBody = {
          command: {
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
          deviceId: this.deviceId,
          domainType: this.currentPreset,
          kind: "service#command",
          serviceDeviceType: "cloud.smarthq.device.dishwasher",
          serviceType: "cloud.smarthq.service.dishwasher.mode.v1",
        };
        validCommand = true;

        break;
      default:
        cmdBody = {
          command: {
            washZone: this.currentWashZone,
            heatedDry: this.currentHeatedDry,
            bottleWash: this.currentbottleWash,
            silverwareWash: this.currentSilverwareWash,
            commandType: "cloud.smarthq.command.dishwasher.mode.v1.set",
          },
          deviceId: this.deviceId,
          domainType: "this.currentPreset",
          kind: "service#command",
          serviceDeviceType: "cloud.smarthq.device.dishwasher",
          serviceType: "cloud.smarthq.service.dishwasher.state.v1",
        };
    }
    if (validCommand) {
      try {
        const response = await this.client.sendCommand(cmdBody); // This command sets the mode and options

        if (response == null) {
          this.client.debug("No response from setActive command");
          return false;
        } else {
          this.client.debug(
            "=======================Response from set command : " + response.outcome,
          );
          return response.success;
        }
      } catch (error) {
        console.warn("Error sending setActive command: " + error);
      }
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
          .updateValue(true);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.SetDuration)
          .updateValue(this.totalSeconds);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.RemainingDuration)
          .updateValue(this.totalSeconds);
        return response.success;
      }
    } catch (error) {
      console.warn("Error sending startCycle command: " + error);
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
          .updateValue(false);
        this.totalSeconds = 0; // reset total seconds when cycle is stopped
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.SetDuration)
          .updateValue(this.totalSeconds);
        this.accessory
          .getService("Dishwasher")
          ?.getCharacteristic(this.Characteristic.RemainingDuration)
          .updateValue(this.totalSeconds);
        return response.success;
      }
    } catch (error) {
      console.warn("Error sending stopCycle command: " + error);
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
      console.log(
        "Failed to connect to SmartHQ WebSocket during platform initialization: " + error,
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
}
