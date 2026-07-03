import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform }              from '../platform.js';
import { ServiceMessage }               from '../index.js';

export class AirConditioner {
  private targetCelsius = 22.22;
  private targetMode = 'cloud.smarthq.type.thermostatmode.cool';

  private targetFanSpeed = 'cloud.smarthq.type.fanspeed.medium';
  private lastManualFanSpeed = 'cloud.smarthq.type.fanspeed.medium';

  private targetFanState: 'AUTO' | 'MANUAL' = 'AUTO';

  private isOn = false;

  private client: SmartHQClient;
  public Service: typeof Service;
  public Characteristic: typeof Characteristic;
  private api: API;

  private readonly modeToHK: Record<string, number> = {};
  private hkToMode: Record<number, string> = {};

  private acThermostat!: Service;
  private acFan!: Service;

  private modeSwitches: Record<string, Service> = {};

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public readonly deviceServices: DeviceService[],
    public readonly deviceId: string,
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
      'cloud.smarthq.type.thermostatmode.dry': HK.COOL,
    };

    this.hkToMode = {
      [HK.OFF]: 'cloud.smarthq.type.thermostatmode.fanonly',
      [HK.COOL]: 'cloud.smarthq.type.thermostatmode.cool',
      [HK.HEAT]: 'cloud.smarthq.type.thermostatmode.cool',
      [HK.AUTO]: 'cloud.smarthq.type.thermostatmode.cool.energysaver',
    };

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
          this.targetFanState = 'AUTO';
        } else {
          this.targetFanState = 'MANUAL';
          this.targetFanSpeed = fs;
          this.lastManualFanSpeed = fs;
        }
      }

      if (thermoSvc.state.on != null) {
        this.isOn = thermoSvc.state.on as boolean;
      }
    }

    this.setupWebSocket();

    this.client.on('service_update', (message: ServiceMessage) => {
      if (message.domainType !== 'cloud.smarthq.domain.thermostat') return;

      if (message.state?.on !== undefined) {
        this.isOn = message.state.on as boolean;
        this.acFan?.getCharacteristic(this.Characteristic.On).updateValue(this.isOn);
      }

      if (message.state?.coolCelsiusConverted !== undefined) {
        this.targetCelsius = message.state.coolCelsiusConverted as number;
        this.acThermostat?.getCharacteristic(this.Characteristic.TargetTemperature)
          .updateValue(this.targetCelsius);
      }

      if (message.state?.mode !== undefined) {
        this.targetMode = message.state.mode as string;
        const hkMode = this.modeToHK[this.targetMode] ?? HK.COOL;
        this.acThermostat?.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
          .updateValue(hkMode);

        this.updateModeSwitches(this.targetMode);
      }

      if (message.state?.fanSpeed != null) {
        const incoming = message.state.fanSpeed as string;

        if (incoming === 'cloud.smarthq.type.fanspeed.auto') {
          this.targetFanState = 'AUTO';
          this.targetFanSpeed = 'cloud.smarthq.type.fanspeed.auto';

          this.acFan?.getCharacteristic(this.Characteristic.TargetFanState)
            ?.updateValue(this.Characteristic.TargetFanState.AUTO);

          return;
        }

        // device forces MANUAL when non-auto
        this.targetFanState = 'MANUAL';
        this.targetFanSpeed = incoming;
        this.lastManualFanSpeed = incoming;

        this.acFan?.getCharacteristic(this.Characteristic.TargetFanState)
          ?.updateValue(this.Characteristic.TargetFanState.MANUAL);

        this.acFan?.getCharacteristic(this.Characteristic.RotationSpeed)
          .updateValue(this.fanSpeedToPercent(incoming));
      }
    });

    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer, 'GE')
      .setCharacteristic(this.Characteristic.Model, accessory.context.device.model || 'AHTT08BC')
      .setCharacteristic(this.Characteristic.SerialNumber, accessory.context.device.serial || 'Default-Serial');

    const displayName = 'Air Conditioner';
    this.acThermostat = this.accessory.getService(displayName)
      || this.accessory.addService(this.Service.Thermostat, displayName, 'ac-thermo1');

    this.acThermostat.setCharacteristic(this.Characteristic.Name, displayName);

    this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    const fanDisplayName = 'AC Fan Speed';
    this.acFan = this.accessory.getService(fanDisplayName)
      || this.accessory.addService(this.Service.Fan, fanDisplayName, 'ac-fan1');

    this.acFan.setCharacteristic(this.Characteristic.Name, fanDisplayName);

    this.acFan.getCharacteristic(this.Characteristic.TargetFanState)
      .onGet(() => this.targetFanState === 'AUTO'
        ? this.Characteristic.TargetFanState.AUTO
        : this.Characteristic.TargetFanState.MANUAL)
      .onSet(async (value: CharacteristicValue) => {
        const v = value as number;

        if (v === this.Characteristic.TargetFanState.AUTO) {
          this.targetFanState = 'AUTO';
          this.targetFanSpeed = 'cloud.smarthq.type.fanspeed.auto';

          await this.sendThermostatCommand(
            this.targetMode,
            this.targetCelsius,
            this.targetFanSpeed,
            this.isOn,
          );
          return;
        }

        this.targetFanState = 'MANUAL';
        this.targetFanSpeed = this.lastManualFanSpeed;
      });

    this.acFan.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.isOn)
      .onSet(async (value: CharacteristicValue) => {
        await this.setTargetHeatingCoolingState(
          value
            ? this.Characteristic.TargetHeatingCoolingState.COOL
            : this.Characteristic.TargetHeatingCoolingState.OFF,
        );
      });

    this.acFan.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({ minValue: 25, maxValue: 100, minStep: 25 })
      .onGet(() => this.fanSpeedToPercent(this.targetFanSpeed))
      .onSet(async (value: CharacteristicValue) => {
        this.targetFanState = 'MANUAL';

        this.targetFanSpeed = this.percentToFanSpeed(value as number);
        this.lastManualFanSpeed = this.targetFanSpeed;

        await this.sendThermostatCommand(
          this.targetMode,
          this.targetCelsius,
          this.targetFanSpeed,
          this.isOn,
        );
      });

    this.updateModeSwitches(this.isOn ? this.targetMode : '');

    setInterval(() => {
      this.getCurrentTemperature().then(temp => {
        this.acThermostat.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temp);
      });

      this.getCurrentHeatingCoolingState().then(state => {
        const running = state === this.Characteristic.CurrentHeatingCoolingState.COOL;
        this.acFan.getCharacteristic(this.Characteristic.On).updateValue(running);
      });
    }, 30000);
  }

  private updateModeSwitches(activeMode: string) {
    for (const [mode, svc] of Object.entries(this.modeSwitches)) {
      svc.getCharacteristic(this.Characteristic.On)
        .updateValue(this.isOn && mode === activeMode);
    }
  }

  private fanSpeedToPercent(fanSpeed: string): number {
    switch (fanSpeed) {
      case 'cloud.smarthq.type.fanspeed.high': return 100;
      case 'cloud.smarthq.type.fanspeed.medium': return 50;
      case 'cloud.smarthq.type.fanspeed.low': return 25;
      default: return 50;
    }
  }

  private percentToFanSpeed(percent: number): string {
    if (percent >= 75) return 'cloud.smarthq.type.fanspeed.high';
    if (percent >= 40) return 'cloud.smarthq.type.fanspeed.medium';
    return 'cloud.smarthq.type.fanspeed.low';
  }

  private async sendThermostatCommand(
    mode: string,
    celsius: number,
    fanSpeed: string,
    on: boolean,
  ) {
    const svc = this.findService(
      'cloud.smarthq.service.thermostat.v1',
      'cloud.smarthq.domain.thermostat',
    );
    if (!svc) return;

    const command: Record<string, unknown> = {
      commandType: 'cloud.smarthq.command.thermostat.v1.set',
      on,
    };

    if (on) {
      command.mode = mode;

      if (mode !== 'cloud.smarthq.type.thermostatmode.dry') {
        command.fanSpeed = fanSpeed;
      }

      command.coolFahrenheit = Math.round(celsius * 9 / 5 + 32);
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

  private findService(serviceType: string, domainType: string): DeviceService | undefined {
    return this.deviceServices.find(
      s => s.serviceType === serviceType && s.domainType === domainType,
    );
  }

  async getCurrentHeatingCoolingState(): Promise<number> {
  return this.getTargetHeatingCoolingState();
}

  async getTargetHeatingCoolingState(): Promise<number> {
    return this.isOn
      ? this.modeToHK[this.targetMode] ?? this.Characteristic.TargetHeatingCoolingState.COOL
      : this.Characteristic.TargetHeatingCoolingState.OFF;
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const HK = this.Characteristic.TargetHeatingCoolingState;

    if (value === HK.OFF) {
      this.isOn = false;
      await this.sendThermostatCommand(this.targetMode, this.targetCelsius, this.targetFanSpeed, false);
      return;
    }

    this.isOn = true;
    const newMode = this.hkToMode[value as number] ?? 'cloud.smarthq.type.thermostatmode.cool';
    this.targetMode = newMode;

    await this.sendThermostatCommand(newMode, this.targetCelsius, this.targetFanSpeed, true);
  }

  getTargetTemperature(): number {
    return this.targetCelsius;
  }

  async getCurrentTemperature(): Promise<number> {
  return this.getTargetTemperature();
}

  async setTargetTemperature(value: CharacteristicValue) {
    this.targetCelsius = value as number;
    if (this.isOn) {
      await this.sendThermostatCommand(this.targetMode, this.targetCelsius, this.targetFanSpeed, true);
    }
  }

  handleTemperatureDisplayUnitsGet(): number {
    return this.Characteristic.TemperatureDisplayUnits.FAHRENHEIT;
  }

  handleTemperatureDisplayUnitsSet(value: CharacteristicValue) {
    this.client.debug('Temp units: ' + value);
  }

  async setupWebSocket() {
    await this.client.authenticate();
    await this.client.connect();
  }
}
