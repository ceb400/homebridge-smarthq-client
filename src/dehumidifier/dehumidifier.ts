import {
  API,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';

import { SmartHQClient, DeviceService, SendCommandRequest } from 'ge-smarthq';
import { SmartHqPlatform } from '../platform.js';
import { ServiceMessage } from '../index.js';
import chalk from 'chalk';

/**
 * GE SmartHQ Dehumidifier (e.g. model ADSE25WWT).
 *
 * The dehumidifier exposes the SAME thermostat.v1 service the window AC uses, so
 * this accessory is modeled on airConditioner.ts. Mapping:
 *
 *   thermostat.v1 / domain.thermostat   -> on, mode (on/off/continuous),
 *                                          fanSpeed (high/low/smart.dry),
 *                                          humidity (target %, 35-80)
 *   integer / domain.humidity.ambient   -> current relative humidity (value %)
 *   toggle  / domain.bucket.status      -> bucket full   (on == full)
 *   toggle  / domain.filter.status      -> clean filter  (on == needs cleaning)
 *
 * HomeKit surface (all on one accessory):
 *   HumidifierDehumidifier  -> Active, Current/Target state, CurrentRelativeHumidity,
 *                              RelativeHumidityDehumidifierThreshold (target),
 *                              RotationSpeed (fan), WaterLevel (bucket)
 *   FilterMaintenance       -> FilterChangeIndication
 *   LeakSensor              -> bucket full (drives Home push notifications)
 *   Switch "Continuous"     -> toggles continuous mode
 */
export class Dehumidifier {
  // ======== SmartHQ constants ========
  private readonly DEVICE_TYPE = 'cloud.smarthq.device.dehumidifier';
  private readonly SVC_THERMOSTAT = 'cloud.smarthq.service.thermostat.v1';
  private readonly DOM_THERMOSTAT = 'cloud.smarthq.domain.thermostat';
  private readonly SVC_INTEGER = 'cloud.smarthq.service.integer';
  private readonly DOM_HUMIDITY_AMBIENT = 'cloud.smarthq.domain.humidity.ambient';
  private readonly SVC_TOGGLE = 'cloud.smarthq.service.toggle';
  private readonly DOM_BUCKET = 'cloud.smarthq.domain.bucket.status';
  private readonly DOM_FILTER = 'cloud.smarthq.domain.filter.status';
  private readonly CMD_SET = 'cloud.smarthq.command.thermostat.v1.set';

  private readonly MODE_ON = 'cloud.smarthq.type.thermostatmode.on';
  private readonly MODE_OFF = 'cloud.smarthq.type.thermostatmode.off';
  private readonly MODE_CONTINUOUS = 'cloud.smarthq.type.thermostatmode.continuous';

  private readonly FAN_LOW = 'cloud.smarthq.type.fanspeed.low';
  private readonly FAN_HIGH = 'cloud.smarthq.type.fanspeed.high';
  private readonly FAN_SMART_DRY = 'cloud.smarthq.type.fanspeed.smart.dry';

  // Fan speeds this unit actually supports, in slider order. Seeded from the
  // device's own thermostat config (supportedFanSpeeds) so other GE dehumidifier
  // models with different speeds work without code changes; this is only a fallback.
  private supportedFanSpeeds: string[] = [this.FAN_LOW, this.FAN_HIGH, this.FAN_SMART_DRY];

  // ======== State cache ========
  private isOn = false;
  private lastActiveMode = this.MODE_ON;
  private lastActiveFanSpeed = this.FAN_HIGH;
  private targetHumidity = 45;
  private currentHumidity = 50;
  private bucketFull = false;
  private filterNeedsCleaning = false;

  private humidityMin: number;
  private humidityMax: number;

  private disposed = false;
  private readonly serviceUpdateListener: (message: ServiceMessage) => void;

  private client: SmartHQClient;
  private api: API;
  public Service: typeof Service;
  public Characteristic: typeof Characteristic;

  private parentAccessory: PlatformAccessory;

  // Services
  private dhum!: Service;
  private filterService!: Service;
  private bucketLeak!: Service;
  private continuousSwitch!: Service;

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceServices: DeviceService[],
    private readonly deviceId: string,
  ) {
    this.api = platform.api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;
    this.parentAccessory = accessory;

    this.client = new SmartHQClient({
      clientId: platform.config.clientId,
      clientSecret: platform.config.clientSecret,
      redirectUri: platform.config.redirectUri,
      debug: platform.config.debugLogging || false,
    });

    // Initialize properties with defaults (in case we return early)
    this.humidityMin = (platform.config.humidityMin as number) ?? 35;
    this.humidityMax = (platform.config.humidityMax as number) ?? 80;
    this.serviceUpdateListener = () => {};

    // Check if dehumidifier service is excluded from config
    if (this.platform.config.excludeDehumidifierServices) {
      this.platform.log.info(chalk.yellow(`Dehumidifier service is excluded from config. Clearing old UUIDs for ${this.deviceId}`));
      // Clear old services from cache before returning
      this.clearOldServices(this.accessory);
      return;
    }

    // Initialize humidity thresholds from config
    this.humidityMin = (platform.config.humidityMin as number) ?? 35;
    this.humidityMax = (platform.config.humidityMax as number) ?? 80;

    // ---- Seed initial state from discovery snapshot ----
    const thermostat = this.findService(this.SVC_THERMOSTAT, this.DOM_THERMOSTAT);
    if (thermostat?.state) {
      const s = thermostat.state;
      if (s.on != null) this.isOn = s.on as boolean;
      if (s.mode != null) this.lastActiveMode = s.mode as string;
      if (s.fanSpeed != null) this.lastActiveFanSpeed = s.fanSpeed as string;
      if (s.humidity != null) this.targetHumidity = s.humidity as number;
    }
    if (thermostat?.config) {
      const c = thermostat.config;
      if (c.humidityMinimum != null) this.humidityMin = c.humidityMinimum as number;
      if (c.humidityMaximum != null) this.humidityMax = c.humidityMaximum as number;
      if (Array.isArray(c.supportedFanSpeeds) && c.supportedFanSpeeds.length > 0) {
        this.supportedFanSpeeds = (c.supportedFanSpeeds as string[]).slice();
      }
    }

    const ambient = this.findService(this.SVC_INTEGER, this.DOM_HUMIDITY_AMBIENT);
    if (ambient?.state?.value != null) {
      this.currentHumidity = ambient.state.value as number;
    }

    const bucket = this.findService(this.SVC_TOGGLE, this.DOM_BUCKET);
    if (bucket?.state?.on != null) this.bucketFull = bucket.state.on as boolean;

    const filter = this.findService(this.SVC_TOGGLE, this.DOM_FILTER);
    if (filter?.state?.on != null) this.filterNeedsCleaning = filter.state.on as boolean;

    this.setupServices();
    this.setupWebSocket();

    this.serviceUpdateListener = (message: ServiceMessage) => {
      if (message.deviceId !== this.deviceId) return;
      this.handleUpdate(message);
    };
    this.client.on('service_update', this.serviceUpdateListener);
  }

  // ---------------------------
  // SERVICE SETUP
  // ---------------------------
  private setupServices() {
    // Clean up any stale services HomeKit may have cached for this accessory.
    const keepUUIDs = new Set<string>([
      this.Service.AccessoryInformation.UUID,
      this.Service.HumidifierDehumidifier.UUID,
      this.Service.FilterMaintenance.UUID,
      this.Service.LeakSensor.UUID,
      this.Service.Switch.UUID,
    ]);
    for (const svc of [...this.parentAccessory.services]) {
      if (!keepUUIDs.has(svc.UUID)) {
        this.parentAccessory.removeService(svc);
      }
    }

    // Accessory info
    const info = this.parentAccessory.getService(this.Service.AccessoryInformation)!;
    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(
        this.Characteristic.Model,
        this.parentAccessory.context.device.model || 'Dehumidifier',
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.parentAccessory.context.device.serial || 'Unknown',
      );

    const name = this.parentAccessory.displayName;

    // ======== HumidifierDehumidifier ========
    this.dhum =
      this.parentAccessory.getService(this.Service.HumidifierDehumidifier) ||
      this.parentAccessory.addService(this.Service.HumidifierDehumidifier, name, `${this.deviceId}-dhum`);

    this.dhum
      .getCharacteristic(this.Characteristic.Active)
      .onGet(() => (this.isOn ? 1 : 0))
      .onSet(async (value) => {
        this.isOn = (value as number) === 1;
        const command: Record<string, unknown> = { on: this.isOn, commandType: this.CMD_SET };
        if (this.isOn) {
          command.mode = this.lastActiveMode === this.MODE_OFF ? this.MODE_ON : this.lastActiveMode;
        }
        this.sendThermostat(command);
        this.refreshCurrentState();
      });

    this.dhum
      .getCharacteristic(this.Characteristic.CurrentHumidifierDehumidifierState)
      .setProps({
        validValues: [
          this.Characteristic.CurrentHumidifierDehumidifierState.INACTIVE,
          this.Characteristic.CurrentHumidifierDehumidifierState.IDLE,
          this.Characteristic.CurrentHumidifierDehumidifierState.DEHUMIDIFYING,
        ],
      })
      .onGet(() => this.computeCurrentState());

    this.dhum
      .getCharacteristic(this.Characteristic.TargetHumidifierDehumidifierState)
      .setProps({ validValues: [this.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER] })
      .onGet(() => this.Characteristic.TargetHumidifierDehumidifierState.DEHUMIDIFIER)
      .onSet(async () => {
        // Locked to DEHUMIDIFIER
      });

    this.dhum
      .getCharacteristic(this.Characteristic.CurrentRelativeHumidity)
      .onGet(() => this.currentHumidity);

    this.dhum
      .getCharacteristic(this.Characteristic.RelativeHumidityDehumidifierThreshold)
      .setProps({ minValue: this.humidityMin, maxValue: this.humidityMax, minStep: 5 })
      .onGet(() => this.clampHumidity(this.targetHumidity))
      .onSet(async (value) => {
        this.targetHumidity = this.clampHumidity(value as number);
        this.sendThermostat({ humidity: this.targetHumidity, commandType: this.CMD_SET });
      });

    // Fan speed via RotationSpeed (low / high / smart-dry mapped to 3 buckets)
    this.dhum
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.fanSpeedToPercent(this.lastActiveFanSpeed))
      .onSet(async (value) => {
        const fan = this.percentToFanSpeed(value as number);
        this.lastActiveFanSpeed = fan;
        this.sendThermostat({ fanSpeed: fan, commandType: this.CMD_SET });
      });

    this.dhum
      .getCharacteristic(this.Characteristic.WaterLevel)
      .onGet(() => (this.bucketFull ? 100 : 0));

    // ======== Filter maintenance ========
    this.filterService =
      this.parentAccessory.getService(this.Service.FilterMaintenance) ||
      this.parentAccessory.addService(this.Service.FilterMaintenance, 'Filter', `${this.deviceId}-filter`);
    this.filterService
      .getCharacteristic(this.Characteristic.FilterChangeIndication)
      .onGet(() =>
        this.filterNeedsCleaning
          ? this.Characteristic.FilterChangeIndication.CHANGE_FILTER
          : this.Characteristic.FilterChangeIndication.FILTER_OK,
      );

    // ======== Bucket full -> LeakSensor (for Home notifications) ========
    this.bucketLeak =
      this.parentAccessory.getService(this.Service.LeakSensor) ||
      this.parentAccessory.addService(this.Service.LeakSensor, 'Bucket Full', `${this.deviceId}-bucket`);
    this.bucketLeak
      .getCharacteristic(this.Characteristic.LeakDetected)
      .onGet(() =>
        this.bucketFull
          ? this.Characteristic.LeakDetected.LEAK_DETECTED
          : this.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
      );

    // ======== Continuous mode switch ========
    this.continuousSwitch =
      this.parentAccessory.getService('Continuous Mode') ||
      this.parentAccessory.addService(this.Service.Switch, 'Continuous Mode', `${this.deviceId}-continuous`);
    this.continuousSwitch
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.lastActiveMode === this.MODE_CONTINUOUS)
      .onSet(async (value) => {
        this.lastActiveMode = value ? this.MODE_CONTINUOUS : this.MODE_ON;
        this.sendThermostat({ on: true, mode: this.lastActiveMode, commandType: this.CMD_SET });
        this.isOn = true;
        this.dhum.updateCharacteristic(this.Characteristic.Active, 1);
      });
  }

  // ---------------------------
  // WEBSOCKET UPDATES
  // ---------------------------
  private handleUpdate(message: ServiceMessage) {
    const state = message.state;
    if (!state) return;

    switch (message.domainType) {
      case this.DOM_THERMOSTAT: {
        if (state.on !== undefined) {
          this.isOn = state.on as boolean;
          this.dhum.updateCharacteristic(this.Characteristic.Active, this.isOn ? 1 : 0);
        }
        if (state.mode !== undefined) {
          this.lastActiveMode = state.mode as string;
          this.continuousSwitch.updateCharacteristic(
            this.Characteristic.On,
            this.lastActiveMode === this.MODE_CONTINUOUS,
          );
        }
        if (state.fanSpeed !== undefined) {
          this.lastActiveFanSpeed = state.fanSpeed as string;
          this.dhum.updateCharacteristic(
            this.Characteristic.RotationSpeed,
            this.fanSpeedToPercent(this.lastActiveFanSpeed),
          );
        }
        if (state.humidity !== undefined) {
          this.targetHumidity = this.clampHumidity(state.humidity as number);
          this.dhum.updateCharacteristic(
            this.Characteristic.RelativeHumidityDehumidifierThreshold,
            this.targetHumidity,
          );
        }
        this.refreshCurrentState();
        break;
      }
      case this.DOM_HUMIDITY_AMBIENT: {
        if (state.value !== undefined) {
          this.currentHumidity = state.value as number;
          this.dhum.updateCharacteristic(this.Characteristic.CurrentRelativeHumidity, this.currentHumidity);
          this.refreshCurrentState();
        }
        break;
      }
      case this.DOM_BUCKET: {
        if (state.on !== undefined) {
          this.bucketFull = state.on as boolean;
          this.dhum.updateCharacteristic(
            this.Characteristic.WaterLevel,
            this.bucketFull ? 100 : 0,
          );
          this.bucketLeak.updateCharacteristic(
            this.Characteristic.LeakDetected,
            this.bucketFull
              ? this.Characteristic.LeakDetected.LEAK_DETECTED
              : this.Characteristic.LeakDetected.LEAK_NOT_DETECTED,
          );
        }
        break;
      }
      case this.DOM_FILTER: {
        if (state.on !== undefined) {
          this.filterNeedsCleaning = state.on as boolean;
          this.filterService.updateCharacteristic(
            this.Characteristic.FilterChangeIndication,
            this.filterNeedsCleaning
              ? this.Characteristic.FilterChangeIndication.CHANGE_FILTER
              : this.Characteristic.FilterChangeIndication.FILTER_OK,
          );
        }
        break;
      }
      default:
        break;
    }
  }

  // ---------------------------
  // COMMAND SENDER
  // ---------------------------
  private sendThermostat(command: Record<string, unknown>) {
    const cmdBody = {
      command,
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: this.DEVICE_TYPE,
      serviceType: this.SVC_THERMOSTAT,
      domainType: this.DOM_THERMOSTAT,
    } as unknown as SendCommandRequest;
    this.sendCommand(cmdBody);
  }

  private async sendCommand(cmdBody: SendCommandRequest) {
    try {
      const response = await this.client.sendCommand(cmdBody);
      if (response == null) {
        this.client.debug('No response from send command');
        return false;
      }
      return response.success;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      this.platform.log.error(chalk.red(`Dehumidifier sendCommand failed: ${message}`));
      return false;
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

  private clampHumidity(value: number): number {
    return Math.max(this.humidityMin, Math.min(this.humidityMax, Math.round(value)));
  }

  // Map a fan-speed string to a RotationSpeed percentage, spacing the supported
  // speeds evenly across 0-100 (e.g. 3 speeds -> 33 / 66 / 100).
  private fanSpeedToPercent(fan: string): number {
    const n = this.supportedFanSpeeds.length;
    if (n === 0) return 100;
    const idx = this.supportedFanSpeeds.indexOf(fan);
    const rank = idx === -1 ? n - 1 : idx;
    return Math.round(((rank + 1) / n) * 100);
  }

  // Map a RotationSpeed percentage back to the nearest supported fan speed.
  private percentToFanSpeed(percent: number): string {
    const n = this.supportedFanSpeeds.length;
    if (n === 0) return this.lastActiveFanSpeed;
    const step = 100 / n;
    const idx = Math.min(n - 1, Math.max(0, Math.ceil(percent / step) - 1));
    return this.supportedFanSpeeds[idx];
  }

  private computeCurrentState(): number {
    const C = this.Characteristic.CurrentHumidifierDehumidifierState;
    if (!this.isOn) return C.INACTIVE;
    return this.currentHumidity > this.targetHumidity ? C.DEHUMIDIFYING : C.IDLE;
  }

  private refreshCurrentState() {
    this.dhum.updateCharacteristic(
      this.Characteristic.CurrentHumidifierDehumidifierState,
      this.computeCurrentState(),
    );
  }

  private async setupWebSocket() {
    try {
      await this.client.authenticate();
      await this.client.connect();
    } catch (error) {
      this.platform.log.error(
        `Failed to connect to SmartHQ WebSocket for Dehumidifier ${this.deviceId}:`,
        error,
      );
    }
  }

  public async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.client.removeListener('service_update', this.serviceUpdateListener);
    } catch {
      // best-effort
    }
    try {
      await this.client.disconnect();
    } catch (error) {
      this.platform.log.error(
        `Failed to disconnect SmartHQ client for Dehumidifier ${this.deviceId}:`,
        error,
      );
    }
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
    servicesToRemove.forEach(service => {
      this.client.debug(chalk.yellow(`Removing cached service: ${service.displayName}`));
      accessory.removeService(service);
    });
  }
}
