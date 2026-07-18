import {
  API,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';

import { SmartHQClient, DeviceService, SendCommandRequest } from 'ge-smarthq-api';
import { SmartHqPlatform } from '../platform.js';
import { ServiceMessage } from '../index.js';
import chalk from 'chalk';

export class AirConditioner {
  // State cache
  private lastActiveMode = 'cloud.smarthq.type.thermostatmode.cool';
  private lastActiveFanSpeedMode = 'cloud.smarthq.type.fanspeed.low';
  private lastActiveCelsius = 22.22;
  private isOn = false;
  private physicalOnState = false;
  private commandQueue: Promise<void> = Promise.resolve();
  private debounceTimeout: NodeJS.Timeout | null = null;

  private currentAmbientCelsius = 22.22;

  // Configuration thresholds
  private coolCelsiusMin = 17.77;
  private coolCelsiusMax = 30.0;

  //========  Thermostat mode constants  ========
  private readonly MODE_COOL =          "cloud.smarthq.type.thermostatmode.cool";
  private readonly MODE_FANONLY =       "cloud.smarthq.type.thermostatmode.fanonly";
  private readonly MODE_DRY =           "cloud.smarthq.type.thermostatmode.dry";
  private readonly MODE_ENERGY_SAVER =  "cloud.smarthq.type.thermostatmode.cool.energysaver";
  private readonly MODE_COOL_QUIET   =  "cloud.smarthq.type.thermostatmode.cool.quiet";
  private readonly MODE_COOL_TURBO   =  "cloud.smarthq.type.thermostatmode.cool.turbo";
  private readonly MODE_HEAT   =        "cloud.smarthq.type.thermostatmode.heat";
  private readonly MODE_OFF   =         "cloud.smarthq.type.thermostatmode.off";
  private readonly MODE_ON   =          "cloud.smarthq.type.thermostatmode.on";

  //========  Fan speed constants  ========
  private readonly FAN_SPEED_LOW =    "cloud.smarthq.type.fanspeed.low";
  private readonly FAN_SPEED_MEDIUM = "cloud.smarthq.type.fanspeed.medium";
  private readonly FAN_SPEED_HIGH =   "cloud.smarthq.type.fanspeed.high"
  private readonly FAN_SPEED_AUTO =   "cloud.smarthq.type.fanspeed.auto";
  private readonly FAN_SPEED_OFF =    "cloud.smarthq.type.fanspeed.off";

  private client: SmartHQClient;
  private api: API;

  public Service: typeof Service;
  public Characteristic: typeof Characteristic;

  // Accessories
  private parentAccessory: PlatformAccessory;
  private modesAccessory: PlatformAccessory | undefined;
  private fanAccessory: PlatformAccessory | undefined;

  // Services
  private acThermostat!: Service;
  private modeOutlets: Map<string, Service> = new Map();
  private fanOutlets: Map<string, Service> = new Map();

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory, // Parent: Air Conditioner
    private readonly deviceServices: DeviceService[],
    private readonly deviceId: string,
    private readonly groupAccessory: PlatformAccessory[], // [Modes, Fan]
  ) {
    this.api = platform.api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.parentAccessory = accessory;
    this.modesAccessory = groupAccessory[0];
    this.fanAccessory = groupAccessory[1];

    this.client = new SmartHQClient({
      clientId: platform.config.clientId,
      clientSecret: platform.config.clientSecret,
      redirectUri: platform.config.redirectUri,
      debug: platform.config.debugLogging || false,
    });

    // 1. Find services and initialize local variables
    const thermostatService = this.findService(
      'cloud.smarthq.service.thermostat.v1',
      'cloud.smarthq.domain.thermostat',
    );

    if (thermostatService?.state) {
      if (thermostatService.state.on != null) {
        this.isOn = thermostatService.state.on as boolean;
        this.physicalOnState = this.isOn;
      }
      if (thermostatService.state.coolCelsiusConverted != null) {
        this.lastActiveCelsius = thermostatService.state.coolCelsiusConverted as number;
      }
      if (thermostatService.state.mode != null) {
        this.lastActiveMode = thermostatService.state.mode as string;
      }
      if (thermostatService.state.fanSpeed != null) {
        this.lastActiveFanSpeedMode = thermostatService.state.fanSpeed as string;
      }
    }

    // Load Celsius min/max bounds from thermostat config
    if (thermostatService?.config) {
      if (thermostatService.config.coolCelsiusMinimumConverted != null) {
        this.coolCelsiusMin = thermostatService.config.coolCelsiusMinimumConverted as number;
      }
      if (thermostatService.config.coolCelsiusMaximumConverted != null) {
        this.coolCelsiusMax = thermostatService.config.coolCelsiusMaximumConverted as number;
      }
    }

    // Load initial ambient temperature
    const ambientService = this.findService(
      'cloud.smarthq.service.temperature',
      'cloud.smarthq.domain.indoor.ambient',
    );
    if (ambientService?.state?.celsiusConverted != null) {
      this.currentAmbientCelsius = ambientService.state.celsiusConverted as number;
    }

    // 2. Setup accessories and services
    const supportedModes: string[] = (thermostatService?.config?.supportedModes as string[]) || [];
    const supportedFanSpeeds: string[] = (thermostatService?.config?.supportedFanSpeeds as string[]) || [];

    this.setupAccessories(supportedModes, supportedFanSpeeds);
    this.setupWebSocket();

    // 3. Register WebSocket real-time subscription
    this.client.on('service_update', (message: ServiceMessage) => {
      if (message.deviceId !== this.deviceId) return;
      if (
        message.domainType !== 'cloud.smarthq.domain.thermostat' &&
        message.domainType !== 'cloud.smarthq.domain.indoor.ambient'
      ) return;

      this.handleUpdate(message);
    });
  }

  // ---------------------------
  // ACCESSORIES SETUP
  // ---------------------------

  private setupAccessories(supportedModes: string[], supportedFanSpeeds: string[]) {
    // Clean up old cached services on the parent accessory
    const oldServiceUUIDs = [
      this.Service.Thermostat.UUID,
      this.Service.Fan.UUID,
      this.Service.Fanv2.UUID,
      this.Service.Switch.UUID,
    ];
    for (const service of [...this.parentAccessory.services]) {
      if (oldServiceUUIDs.includes(service.UUID)) {
        this.platform.log.info(`Removing old cached service from parent accessory: ${service.displayName}`);
        this.parentAccessory.removeService(service);
      }
    }

    // A. Parent Accessory: Air Conditioner Info
    const parentInfo = this.parentAccessory.getService(this.Service.AccessoryInformation)!;
    parentInfo
      .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(
        this.Characteristic.Model,
        this.parentAccessory.context.device.model || 'AC Unit',
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.parentAccessory.context.device.serial || 'Unknown',
      );

    // Parent Accessory: HeaterCooler Service
    const name = this.parentAccessory.displayName;
    this.acThermostat =
      this.parentAccessory.getService(name) ||
      this.parentAccessory.addService(this.Service.HeaterCooler, name, `${this.deviceId}-ac-thermostat`);

    this.acThermostat
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isOn ? 1 : 0))
      .onSet(async (value) => {
        this.isOn = (value as number) === 1;

        if (this.isOn) {
          const stateVal = this.lastActiveMode === this.MODE_FANONLY ? 1 : 3;
          this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, stateVal);
          for (const [mode, service] of this.modeOutlets.entries()) {
            service.updateCharacteristic(this.Characteristic.On, this.lastActiveMode === mode);
          }
          for (const [fanSpeed, service] of this.fanOutlets.entries()) {
            service.updateCharacteristic(this.Characteristic.On, this.lastActiveFanSpeedMode === fanSpeed);
          }

          // Turned on, so set mode, fan speed and temperature to last active values. Default to Cool and Low and 22.22C if no last active values.

          const cmdBody = {
            command: {
              mode: this.lastActiveMode || this.MODE_COOL,
              fanSpeed: this.lastActiveFanSpeedMode || this.FAN_SPEED_LOW,
              temperature: this.lastActiveCelsius || 22.22,
              commandType: 'cloud.smarthq.command.thermostat.v1.set',
            },
            kind: 'service#command',
            deviceId: this.deviceId,
            serviceDeviceType: 'cloud.smarthq.device.airconditioner',
            serviceType: 'cloud.smarthq.service.thermostat.v1',
            domainType: 'cloud.smarthq.domain.thermostat',
          };
         

          this.client.debug(chalk.yellow(`## Turning on AC:`));
          this.client.debug(chalk.yellow(JSON.stringify(cmdBody, null, 2)));

          this.sendCommand(cmdBody);

        } else {
          this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, 0);
          for (const service of this.modeOutlets.values()) {
            service.updateCharacteristic(this.Characteristic.On, false);
          }
          for (const service of this.fanOutlets.values()) {
            service.updateCharacteristic(this.Characteristic.On, false);
          }

          // Turned off, so send command to power down AC unit. Note: GE firmware does not support a "power off" command, so we just send the "on" parameter as false to turn off the unit.

          const cmdBody = {
            command: {
              on: this.isOn,
              commandType: 'cloud.smarthq.command.thermostat.v1.set',
            },
            kind: 'service#command',
            deviceId: this.deviceId,
            serviceDeviceType: 'cloud.smarthq.device.airconditioner',
            serviceType: 'cloud.smarthq.service.thermostat.v1',
            domainType: 'cloud.smarthq.domain.thermostat',
          };

          this.client.debug(chalk.yellow(`## Turning off AC:`));
          this.client.debug(chalk.yellow(JSON.stringify(cmdBody, null, 2)));

          this.sendCommand(cmdBody);
        }

        
      });

    this.acThermostat
      .getCharacteristic(this.Characteristic.CurrentHeaterCoolerState)
      .onGet(() => { 
        if (!this.isOn) return 0;
        return this.lastActiveMode === this.MODE_FANONLY ? 1 : 3;
      });

    this.acThermostat
      .getCharacteristic(this.Characteristic.TargetHeaterCoolerState)
      .setProps({ validValues: [2] }) // Restricted to COOL only
      .onGet(() => 2)
      .onSet(async () => {
        // Target is locked to COOL
      });

    this.acThermostat
      .getCharacteristic(this.Characteristic.CoolingThresholdTemperature)
      .setProps({
        minValue: this.coolCelsiusMin,
        maxValue: this.coolCelsiusMax,
        minStep: 0.1,
      })
      .onGet(() => this.lastActiveCelsius)
      .onSet(async (value) => {
        this.lastActiveCelsius = value as number;

        // Clip celsius to hardware bounds to prevent API errors
        const clippedCelsius = Math.max(
          this.coolCelsiusMin,
          Math.min(this.coolCelsiusMax, this.lastActiveCelsius),
        );
        const coolFahrenheit = Math.round(clippedCelsius * 1.8 + 32);


        // Set temperature on the AC unit via API command

        const cmdBody = {
            command: {
              coolFahrenheit: coolFahrenheit,
              commandType: 'cloud.smarthq.command.thermostat.v1.set',
            },
            kind: 'service#command',
            deviceId: this.deviceId,
            serviceDeviceType: 'cloud.smarthq.device.airconditioner',
            serviceType: 'cloud.smarthq.service.thermostat.v1',
            domainType: 'cloud.smarthq.domain.thermostat',
          };

          this.client.debug(chalk.yellow('## Setting AC Temperature:'));
          this.client.debug(chalk.yellow(JSON.stringify(cmdBody, null, 2)));

        this.sendCommand(cmdBody);
      });

    this.acThermostat
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(() => this.currentAmbientCelsius);

    // B. Child Accessory 1: AC Mode Outlets
    if (this.modesAccessory) {
      const modeInfo = this.modesAccessory.getService(this.Service.AccessoryInformation)!;
      modeInfo
        .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
        .setCharacteristic(
          this.Characteristic.Model,
          this.parentAccessory.context.device.model || 'AC Mode Module',
        )
        .setCharacteristic(
          this.Characteristic.SerialNumber,
          this.parentAccessory.context.device.serial || 'Unknown',
        );

      // Clean up stale Mode outlets from cache
      const activeModeServiceUUIDs = new Set<string>();
      for (const mode of supportedModes) {
        const [displayName] = this.getLastElementAndCapitalize(mode, '.');
        const service =
          this.modesAccessory.getService(displayName) ||
          this.modesAccessory.addService(this.Service.Outlet, displayName, mode);

        if (!service.getCharacteristic(this.Characteristic.ConfiguredName)) {
          service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        }
        service.setCharacteristic(this.Characteristic.Name, displayName);
        service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

        activeModeServiceUUIDs.add(service.UUID + (mode || ''));
      }

      for (const service of [...this.modesAccessory.services]) {
        if (service.UUID === this.Service.AccessoryInformation.UUID) continue;
        if (service.UUID === this.Service.Outlet.UUID) {
          const key = service.UUID + (service.subtype || '');
          if (!activeModeServiceUUIDs.has(key)) {
            this.platform.log.info(`Removing stale Mode outlet service: ${service.displayName}`);
            this.modesAccessory.removeService(service);
          }
        }
      }

      // Bind Mode Outlets characteristics
      for (const mode of supportedModes) {
        const [displayName] = this.getLastElementAndCapitalize(mode, '.');
        const service = this.modesAccessory.getService(displayName)!;

        this.modeOutlets.set(mode, service);

        service
          .getCharacteristic(this.Characteristic.On)
          .onGet(() => this.isOn && this.lastActiveMode === mode)
          .onSet(async (value) => {
            if (value) {
              this.isOn = true;
              this.lastActiveMode = mode;

              for (const [modeKey, service] of this.modeOutlets.entries()) {
                if (modeKey !== mode) {
                  service.updateCharacteristic(this.Characteristic.On, false);
                }
              }

              this.acThermostat.updateCharacteristic(this.Characteristic.Active, 1);
              const stateVal = mode === this.MODE_FANONLY ? 1 : 3;
              this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, stateVal);

              for (const [fanspeedMode, service] of this.fanOutlets.entries()) {
                service.updateCharacteristic(this.Characteristic.On, this.lastActiveFanSpeedMode === fanspeedMode);
              }

              // Handle behavior constraint: Fan Only mode does not support Auto Fan Speed - force Fan Speed to Low
              // Dry mode sets fan speed to Auto, which is valid. Only Fan Only mode needs to be adjusted.
              

              let cmdBody: SendCommandRequest;
              switch (mode) {
                case this.MODE_FANONLY:
                  cmdBody = {
                    command: {
                      mode:     this.MODE_FANONLY,  
                      fanSpeed: this.FAN_SPEED_LOW,
                      commandType: 'cloud.smarthq.command.thermostat.v1.set',
                    },
                  kind: 'service#command',
                  deviceId: this.deviceId,
                  serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                  serviceType: 'cloud.smarthq.service.thermostat.v1',
                  domainType: 'cloud.smarthq.domain.thermostat',
                  };
                  break;
                case this.MODE_DRY:
                  cmdBody = {
                    command: {
                      mode:     this.MODE_DRY,
                    //  fanSpeed: this.FAN_SPEED_AUTO,    set to Auto by default for Dry mode, which is valid
                      commandType: 'cloud.smarthq.command.thermostat.v1.set',
                    },
                  kind: 'service#command',
                  deviceId: this.deviceId,
                  serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                  serviceType: 'cloud.smarthq.service.thermostat.v1',
                  domainType: 'cloud.smarthq.domain.thermostat',
                };
                  break;
                  // Default case handles Cool and Heat modes, which support all(?) fan speeds
                default:
                  // Set mode on the AC unit via API command with special handling for Fan Only and Dry modes

                  cmdBody = {
                    command: {
                      mode:     mode,
                      commandType: 'cloud.smarthq.command.thermostat.v1.set',
                    },
                    kind: 'service#command',
                    deviceId: this.deviceId,
                    serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                    serviceType: 'cloud.smarthq.service.thermostat.v1',
                    domainType: 'cloud.smarthq.domain.thermostat',
                  };
              }

              this.client.debug(chalk.yellow('## Setting AC Mode:'));
              this.client.debug(chalk.yellow(JSON.stringify(cmdBody, null, 2)));


              this.sendCommand(cmdBody);
            } else {
              // Toggling active mode OFF powers down system
              if (this.lastActiveMode === mode) {
                this.isOn = false;

                for (const service of this.modeOutlets.values()) {
                  service.updateCharacteristic(this.Characteristic.On, false);
                }
                for (const service of this.fanOutlets.values()) { 
                  service.updateCharacteristic(this.Characteristic.On, false);
                }

                this.acThermostat.updateCharacteristic(this.Characteristic.Active, 0);
                this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, 0);

                const cmdBody: SendCommandRequest = {
                  command: {
                    on: this.isOn,
                    commandType: 'cloud.smarthq.command.thermostat.v1.set',
                  },
                  kind: 'service#command',
                  deviceId: this.deviceId,
                  serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                  serviceType: 'cloud.smarthq.service.thermostat.v1',
                  domainType: 'cloud.smarthq.domain.thermostat',
                };

                this.sendCommand(cmdBody);
              }
            }
          });
      }
    }

    // C. Child Accessory 2: AC Fan Outlets
    if (this.fanAccessory) {
      const fanInfo = this.fanAccessory.getService(this.Service.AccessoryInformation)!;
      fanInfo
        .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
        .setCharacteristic(
          this.Characteristic.Model,
          this.parentAccessory.context.device.model || 'AC Fan Module',
        )
        .setCharacteristic(
          this.Characteristic.SerialNumber,
          this.parentAccessory.context.device.serial || 'Unknown',
        );

      // Clean up stale Fan Speed outlets from cache
      const activeFanServiceUUIDs = new Set<string>();
      for (const fanspeedMode of supportedFanSpeeds) {
        const [displayName] = this.getLastElementAndCapitalize(fanspeedMode, '.');
        const service =
          this.fanAccessory.getService(displayName) ||
          this.fanAccessory.addService(this.Service.Outlet, displayName, fanspeedMode);

        if (!service.getCharacteristic(this.Characteristic.ConfiguredName)) {
          service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
        }
        service.setCharacteristic(this.Characteristic.Name, displayName);
        service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

        activeFanServiceUUIDs.add(service.UUID + (fanspeedMode || ''));
      }

      for (const service of [...this.fanAccessory.services]) {
        if (service.UUID === this.Service.AccessoryInformation.UUID) continue;
        if (service.UUID === this.Service.Outlet.UUID) {
          const key = service.UUID + (service.subtype || '');
          if (!activeFanServiceUUIDs.has(key)) {
            this.platform.log.info(`Removing stale Fan Speed outlet service: ${service.displayName}`);
            this.fanAccessory.removeService(service);
          }
        }
      }

      // Bind Fan Speed Outlets characteristics
      for (const fanspeedMode of supportedFanSpeeds) {
        const [displayName] = this.getLastElementAndCapitalize(fanspeedMode, '.');
        const service = this.fanAccessory.getService(displayName)!;

        this.fanOutlets.set(fanspeedMode, service);

        service
          .getCharacteristic(this.Characteristic.On)
          .onGet(() => this.isOn && this.lastActiveFanSpeedMode === fanspeedMode)
          .onSet(async (value) => {
            if (value) {
              // If mode is Dry, then fan speed is automatically set to Auto and cannot be changed. 
              if (this.lastActiveMode === this.MODE_DRY) {
                return;
              }

              // Handle behavior constraint: Fan Only mode does not support Auto Fan Speed
              if (
                this.lastActiveMode === this.MODE_FANONLY &&
                fanspeedMode === this.FAN_SPEED_AUTO
              ) {
                setTimeout(() => {
                  service.updateCharacteristic(this.Characteristic.On, false);
                  const activeService = this.fanOutlets.get(this.lastActiveFanSpeedMode);
                  if (activeService) {
                    activeService.updateCharacteristic(this.Characteristic.On, this.isOn);
                  }
                }, 50);
                return;
              }

              this.isOn = true;
              this.lastActiveFanSpeedMode = fanspeedMode;

              for (const [fanSpeed, service] of this.fanOutlets.entries()) {
                if (fanSpeed !== fanspeedMode) {
                  service.updateCharacteristic(this.Characteristic.On, false);
                }
              }

              this.acThermostat.updateCharacteristic(this.Characteristic.Active, 1);
              const stateVal = this.lastActiveMode === this.MODE_FANONLY ? 1 : 3;
              this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, stateVal);

              for (const [modeKey, service] of this.modeOutlets.entries()) {
                service.updateCharacteristic(this.Characteristic.On, this.lastActiveMode === modeKey);
              }

              const cmdBody: SendCommandRequest = {
                command: {
                  fanspeed: this.lastActiveFanSpeedMode,
                  commandType: 'cloud.smarthq.command.thermostat.v1.set',
                },
                kind: 'service#command',
                deviceId: this.deviceId,
                serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                serviceType: 'cloud.smarthq.service.thermostat.v1',
                domainType: 'cloud.smarthq.domain.thermostat',
              };

              this.client.debug(chalk.yellow('## Setting Fan Speed from mode:' + this.lastActiveMode));
              this.client.debug(chalk.yellow(JSON.stringify(cmdBody, null, 2)));

              this.sendCommand(cmdBody);
            } else {
              // Toggling active fan speed OFF powers down system
              // note: Fan Speed OFF is not a supported state for the AC unit, so we treat it as a power down command
              // note: don't think the else block is ever reached
              if (this.lastActiveFanSpeedMode === fanspeedMode) {
                this.isOn = false;

                for (const service of this.modeOutlets.values()) {
                  service.updateCharacteristic(this.Characteristic.On, false);
                }
                for (const service of this.fanOutlets.values()) {
                  service.updateCharacteristic(this.Characteristic.On, false);
                }

                this.acThermostat.updateCharacteristic(this.Characteristic.Active, 0);
                this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, 0);
                const cmdBody: SendCommandRequest = {
                  command: {
                    on: this.isOn,
                    commandType: 'cloud.smarthq.command.thermostat.v1.set',
                  },
                  kind: 'service#command',
                  deviceId: this.deviceId,
                  serviceDeviceType: 'cloud.smarthq.device.airconditioner',
                  serviceType: 'cloud.smarthq.service.thermostat.v1',
                  domainType: 'cloud.smarthq.domain.thermostat',
                };

                this.sendCommand(cmdBody);
              }
            }
          });
      }
    }

    // D. Add Debug State switch to parent accessory
    this.addDebugState('cloud.smarthq.service.thermostat.v1');
  }

  // ---------------------------
  // API COMMAND SENDER
  // ---------------------------
  async sendCommand(cmdBody: SendCommandRequest) {
    
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
 /*
  private async executeSendCommand(command: SendCommandRequest) {
    const service = this.findService(
      'cloud.smarthq.service.thermostat.v1',
      'cloud.smarthq.domain.thermostat',
    );

    if (!service) return;

    //this.commandQueue = this.commandQueue.then(async () => {
     
      const command: Record<string, unknown> = {
        commandType: 'cloud.smarthq.command.thermostat.v1.set',
      };
      

      // Only send the 'on' parameter if it is transitioning (prevents GE firmware from resetting to ECO)
      if (!this.isOn) {
        command.on = false;
      } else if (!this.physicalOnState) {
        command.on = true;
      }

      if (this.isOn) {
        command.mode = this.lastActiveMode;

        // Handle behavior constraint: Fan Only mode does not support Auto Fan Speed
        if (
          this.lastActiveMode === this.MODE_FANONLY &&
          this.lastActiveFanSpeedMode === this.FAN_SPEED_AUTO
        ) {
          command.fanSpeed = this.FAN_SPEED_LOW;
        } else {
          command.fanSpeed = this.lastActiveFanSpeedMode;
        }

        // Omit coolFahrenheit in Fan Only mode (thermostat has no cooling setpoint)
        if (this.lastActiveMode !== this.MODE_FANONLY) {
          // Clip celsius to hardware bounds to prevent API errors
          const clippedCelsius = Math.max(
            this.coolCelsiusMin,
            Math.min(this.coolCelsiusMax, this.lastActiveCelsius),
          );
          command.coolFahrenheit = Math.round(clippedCelsius * 1.8 + 32);
        }
      }
        

      try {
        const response = await this.client.sendCommand(command);
          
        if (response == null) {
          this.client.debug("No response from send command");
        } else {
          this.client.debug(
            "####  Response from send command : " + response.outcome,
          );
          return response.success;
        }
      } catch (error) {
        this.platform.log.error(`Error sending command to AC:`, error);
      }

    return true;
  }*/

  // ---------------------------
  // WEBSOCKET UPDATES HANDLING
  // ---------------------------
  private handleUpdate(message: ServiceMessage) {
    const state = message.state;
    if (!state) return;

    if (message.domainType === 'cloud.smarthq.domain.thermostat') {
      if (state.on !== undefined) {
        this.isOn = state.on as boolean;
        this.physicalOnState = this.isOn;
        this.acThermostat.updateCharacteristic(this.Characteristic.Active, this.isOn ? 1 : 0);
      }

      if (state.coolCelsiusConverted !== undefined) {
        this.lastActiveCelsius = state.coolCelsiusConverted as number;
        this.acThermostat.updateCharacteristic(this.Characteristic.CoolingThresholdTemperature, this.lastActiveCelsius);
      }

      if (state.mode !== undefined) {
        this.lastActiveMode = state.mode as string;
      }

      if (state.fanSpeed !== undefined) {
        this.lastActiveFanSpeedMode = state.fanSpeed as string;
      }

      // Update HeaterCooler state dynamically based on power and mode
      const stateVal = !this.isOn
        ? 0
        : (this.lastActiveMode === this.MODE_FANONLY ? 1 : 3);
      this.acThermostat.updateCharacteristic(this.Characteristic.CurrentHeaterCoolerState, stateVal);

      // Update dynamic outlets
      for (const [mode, service] of this.modeOutlets.entries()) {
        service.updateCharacteristic(this.Characteristic.On, this.isOn && this.lastActiveMode === mode);
      }
      for (const [fanSpeed, service] of this.fanOutlets.entries()) {
        service.updateCharacteristic(this.Characteristic.On, this.isOn && this.lastActiveFanSpeedMode === fanSpeed);
      }
    } else if (message.domainType === 'cloud.smarthq.domain.indoor.ambient') {
      if (state.celsiusConverted !== undefined) {
        this.currentAmbientCelsius = state.celsiusConverted as number;
        this.acThermostat.updateCharacteristic(this.Characteristic.CurrentTemperature, this.currentAmbientCelsius);
      }
    }
  }

  // ---------------------------
  // HELPERS
  // ---------------------------
  private findService(serviceType: string, domainType: string) {
    return this.deviceServices.find(
      (service) => service.serviceType === serviceType && service.domainType === domainType,
    );
  }

  private getLastElementAndCapitalize(str: string, delimiter: string): [string, string] {
    const arr = str.split(delimiter);
    const lastElement = arr.at(-1) || arr[arr.length - 1] || '';

    if (!lastElement) {
      return ['', str];
    }

    const firstChar = lastElement.charAt(0).toUpperCase();
    const restOfString = lastElement.slice(1);
    const capitalizedString = firstChar + restOfString;

    return [capitalizedString, str];
  }

  private async setupWebSocket() {
    try {
      await this.client.authenticate();
      await this.client.connect();
    } catch (error) {
      this.platform.log.error(
        `Failed to connect to SmartHQ WebSocket for AC ${this.deviceId}:`,
        error,
      );
    }
  }


// ---------------------------
// HELPERS FOR DEBUGGING
// Adds a 'Debug State' switch to the parent accessory that logs the current state of the specified service type when toggled on
// ---------------------------

  private addDebugState(serviceType: string): void {
  const debugState = this.setupService(
      'Switch',
      'Debug State',
      `${this.deviceId}-debug-state`,
    );

    debugState
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => {
        return debugState.getCharacteristic(this.Characteristic.On).value as boolean;
      })
      .onSet(async (value) => {
        if (value) {
          const response = await  this.client.getDevice(this.deviceId);
          const deviceServices = response.services ?? [];
          for (const service of deviceServices) {
            if (service.serviceType === serviceType) {
              this.client.debug('Debug State - Device Info: ' + JSON.stringify(service, null, 2));
            }
          }

          setTimeout(() => {
            debugState.updateCharacteristic(this.Characteristic.On, false);
          }, 1000);
        }
      });
    }

     setupService(serviceType: string, displayName: string, serviceIdSuffix: string) {
    let service: Service;

    switch (serviceType) {
      case 'Outlet':
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Outlet, displayName, serviceIdSuffix);
        break;

      case 'Switch':
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Switch, displayName, serviceIdSuffix);
        break;

      default:
        this.client.debug('Unknown service type: ' + serviceType + '');
        service =
          this.accessory.getService(displayName) ||
          this.accessory.addService(this.Service.Fan, displayName, serviceIdSuffix);
    }

    service.setCharacteristic(this.Characteristic.Name, displayName);
    service.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    service.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    return service;
  }
}
