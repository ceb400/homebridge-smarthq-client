import {
  API,
  CharacteristicValue,
  PlatformAccessory,
  Service,
  Characteristic,
} from 'homebridge';

import { SmartHQClient, DeviceService } from 'ge-smarthq-api';
import { SmartHqPlatform } from '../platform.js';
import { ServiceMessage } from '../index.js';

export class AirConditioner {
  private targetCelsius = 22.22;
  private targetMode = 'cloud.smarthq.type.thermostatmode.cool';

  private isOn = false;

  // Fan state (clean model)
  private fanAuto = true;
  private fanSpeedPercent = 50;
  private fanSpeedCloud = 'cloud.smarthq.type.fanspeed.medium';

  private client: SmartHQClient;
  private api: API;

  public Service: typeof Service;
  public Characteristic: typeof Characteristic;

  private acThermostat!: Service;
  private acFan!: Service;
  private fanAutoSwitch!: Service;

  private readonly modeToHK: Record<string, number> = {};
  private readonly hkToMode: Record<number, string> = {};

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    private readonly deviceServices: DeviceService[],
    private readonly deviceId: string,
  ) {
    this.api = platform.api;
    this.Service = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.client = new SmartHQClient({
      clientId: platform.config.clientId,
      clientSecret: platform.config.clientSecret,
      redirectUri: platform.config.redirectUri,
      debug: platform.config.debugLogging || false,
    });

    const HK = this.Characteristic.TargetHeatingCoolingState;

    this.modeToHK = {
      'cloud.smarthq.type.thermostatmode.cool': HK.COOL,
      'cloud.smarthq.type.thermostatmode.cool.energysaver': HK.AUTO,
      'cloud.smarthq.type.thermostatmode.fanonly': HK.OFF,
      'cloud.smarthq.type.thermostatmode.dry': HK.HEAT,
    };

    this.hkToMode = {
      [HK.OFF]: 'cloud.smarthq.type.thermostatmode.fanonly',
      [HK.COOL]: 'cloud.smarthq.type.thermostatmode.cool',
      [HK.AUTO]: 'cloud.smarthq.type.thermostatmode.cool.energysaver',
      [HK.HEAT]: 'cloud.smarthq.type.thermostatmode.dry',
    };

    // Load initial state if available
    const thermoSvc = this.findService(
      'cloud.smarthq.service.thermostat.v1',
      'cloud.smarthq.domain.thermostat',
    );

    if (thermoSvc?.state) {
      if (thermoSvc.state.coolCelsiusConverted != null) {
        this.targetCelsius = thermoSvc.state.coolCelsiusConverted as number;
      }

      if (thermoSvc.state.mode != null) {
        this.targetMode = thermoSvc.state.mode as string;
      }

      if (thermoSvc.state.fanSpeed != null) {
        const fs = thermoSvc.state.fanSpeed as string;

        if (fs === 'cloud.smarthq.type.fanspeed.auto') {
          this.fanAuto = true;
        } else {
          this.fanAuto = false;
          this.fanSpeedCloud = fs;
          this.fanSpeedPercent = this.fanSpeedToPercent(fs);
        }
      }

      if (thermoSvc.state.on != null) {
        this.isOn = thermoSvc.state.on as boolean;
      }
    }

    this.setupAccessories();
    this.setupWebSocket();

    this.client.on('service_update', (message: ServiceMessage) => {
      if (message.domainType !== 'cloud.smarthq.domain.thermostat') return;

      this.handleUpdate(message);
    });

    setInterval(() => {
      this.syncState();
    }, 30000);
  }

  // ---------------------------
  // ACCESSORIES
  // ---------------------------

  private setupAccessories() {
    const info = this.accessory.getService(this.Service.AccessoryInformation)!;

    info
      .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(
        this.Characteristic.Model,
        this.accessory.context.device.model || 'AC Unit',
      )
      .setCharacteristic(
        this.Characteristic.SerialNumber,
        this.accessory.context.device.serial || 'Unknown',
      );

    const name = 'Air Conditioner';

    this.acThermostat =
      this.accessory.getService(name) ||
      this.accessory.addService(this.Service.Thermostat, name, 'ac-thermo');

    this.acThermostat
      .getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.acThermostat
      .getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(() => this.targetCelsius)
      .onSet(this.setTargetTemperature.bind(this));

    // FAN SERVICE (slider only)
    const fanName = 'AC Fan Speed';

    this.acFan =
      this.accessory.getService(fanName) ||
      this.accessory.addService(this.Service.Fanv2, fanName, 'ac-fan');

    this.acFan
      .getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 1 })
      .onGet(() => this.fanSpeedPercent)
      .onSet(this.setFanSpeed.bind(this));

    // AUTO SWITCH (IMPORTANT FIX)
    this.fanAutoSwitch =
      this.accessory.getService('Fan Auto Mode') ||
      this.accessory.addService(
        this.Service.Switch,
        'Fan Auto Mode',
        'ac-fan-auto',
      );

    this.fanAutoSwitch
      .getCharacteristic(this.Characteristic.On)
      .onGet(() => this.fanAuto)
      .onSet(this.setFanAuto.bind(this));
  }

  // ---------------------------
  // FAN LOGIC
  // ---------------------------

  private async setFanSpeed(value: CharacteristicValue) {
    this.fanAuto = false;

    this.fanSpeedPercent = value as number;
    this.fanSpeedCloud = this.percentToFanSpeed(this.fanSpeedPercent);

    await this.sendCommand();
  }

  private async setFanAuto(value: CharacteristicValue) {
    this.fanAuto = value as boolean;

    if (this.fanAuto) {
      this.fanSpeedCloud = 'cloud.smarthq.type.fanspeed.auto';
    } else {
      this.fanSpeedCloud = this.percentToFanSpeed(this.fanSpeedPercent);
    }

    await this.sendCommand();
  }

  private fanSpeedToPercent(fanSpeed: string): number {
    switch (fanSpeed) {
      case 'cloud.smarthq.type.fanspeed.high':
        return 100;
      case 'cloud.smarthq.type.fanspeed.medium':
        return 50;
      case 'cloud.smarthq.type.fanspeed.low':
        return 25;
      default:
        return 50;
    }
  }

  private percentToFanSpeed(percent: number): string {
    if (percent >= 75) return 'cloud.smarthq.type.fanspeed.high';
    if (percent >= 40) return 'cloud.smarthq.type.fanspeed.medium';
    return 'cloud.smarthq.type.fanspeed.low';
  }

  // ---------------------------
  // THERMOSTAT LOGIC
  // ---------------------------

  private async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const HK = this.Characteristic.TargetHeatingCoolingState;

    if (value === HK.OFF) {
      this.isOn = false;
    } else {
      this.isOn = true;
      this.targetMode = this.hkToMode[value as number];
    }

    await this.sendCommand();
  }

  private async setTargetTemperature(value: CharacteristicValue) {
    this.targetCelsius = value as number;
    await this.sendCommand();
  }

  private async getTargetHeatingCoolingState(): Promise<number> {
    return this.isOn
      ? this.modeToHK[this.targetMode] ??
          this.Characteristic.TargetHeatingCoolingState.COOL
      : this.Characteristic.TargetHeatingCoolingState.OFF;
  }

  // ---------------------------
  // SMARTHQ COMMAND
  // ---------------------------

  private async sendCommand() {
    const svc = this.findService(
      'cloud.smarthq.service.thermostat.v1',
      'cloud.smarthq.domain.thermostat',
    );

    if (!svc) return;

    const command: Record<string, unknown> = {
      commandType: 'cloud.smarthq.command.thermostat.v1.set',
      on: this.isOn,
    };

    if (this.isOn) {
      command.mode = this.targetMode;
      command.fanSpeed = this.fanSpeedCloud;
      command.coolFahrenheit = Math.round(this.targetCelsius * 1.8 + 32);
    }

    await this.client.sendCommand({
      command,
      kind: 'service#command',
      deviceId: this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.airconditioner',
      serviceType: 'cloud.smarthq.service.thermostat.v1',
      domainType: 'cloud.smarthq.domain.thermostat',
    });
  }

  // ---------------------------
  // LIVE UPDATES
  // ---------------------------

  private handleUpdate(message: ServiceMessage) {
    const state = message.state;

    if (!state) return;

    if (state.on !== undefined) {
      this.isOn = state.on as boolean;
    }

    if (state.coolCelsiusConverted !== undefined) {
      this.targetCelsius = state.coolCelsiusConverted as number;
    }

    if (state.mode !== undefined) {
      this.targetMode = state.mode as string;
    }

    if (state.fanSpeed !== undefined) {
      const fs = state.fanSpeed as string;

      if (fs === 'cloud.smarthq.type.fanspeed.auto') {
        this.fanAuto = true;
      } else {
        this.fanAuto = false;
        this.fanSpeedCloud = fs;
        this.fanSpeedPercent = this.fanSpeedToPercent(fs);
      }

      this.fanAutoSwitch.updateCharacteristic(
        this.Characteristic.On,
        this.fanAuto,
      );

      this.acFan.updateCharacteristic(
        this.Characteristic.RotationSpeed,
        this.fanSpeedPercent,
      );
    }
  }

  private async syncState() {
    this.acThermostat
      .getCharacteristic(this.Characteristic.CurrentTemperature)
      .updateValue(this.targetCelsius);
  }

  // ---------------------------
  // HELPERS
  // ---------------------------

  private findService(serviceType: string, domainType: string) {
    return this.deviceServices.find(
      s => s.serviceType === serviceType && s.domainType === domainType,
    );
  }

  private async setupWebSocket() {
    await this.client.authenticate();
    await this.client.connect();
  }
}
