import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform }              from '../platform.js';
import { ServiceMessage }               from '../index.js';

export class AirConditioner {
  private targetCelsius   = 22.22;
  private targetMode      = 'cloud.smarthq.type.thermostatmode.cool';

  private targetFanSpeed  = 'cloud.smarthq.type.fanspeed.medium';
  private lastManualFanSpeed = 'cloud.smarthq.type.fanspeed.medium';

  private targetFanState  = 'AUTO';

  private isOn            = false;

  private client: SmartHQClient;
  public  Service: typeof Service;
  public  Characteristic: typeof Characteristic;
  private api: API;

  private readonly modeToHK: Record<string, number> = {};
  private hkToMode: Record<number, string> = {};

  // Promoted to class properties so handlers outside constructor can access them
  private acThermostat!: Service;
  private acFan!: Service;

  // Mode switch service references for mutual exclusion updates
  private modeSwitches: Record<string, Service> = {};

  constructor(
    private readonly platform: SmartHqPlatform,
    private readonly accessory: PlatformAccessory,
    public  readonly deviceServices: DeviceService[],
    public  readonly deviceId: string,
  ) {
    this.api            = platform.api;
    this.Service        = this.api.hap.Service;
    this.Characteristic = this.api.hap.Characteristic;

    this.client = new SmartHQClient({
      clientId:     platform.config.clientId,
      clientSecret: platform.config.clientSecret,
      redirectUri:  platform.config.redirectUri,
      debug:        platform.config.debugLogging || false,
    });

    const HK = this.Characteristic.TargetHeatingCoolingState;
    this.modeToHK = {
      'cloud.smarthq.type.thermostatmode.cool':             HK.COOL,
      'cloud.smarthq.type.thermostatmode.cool.energysaver': HK.AUTO,
      'cloud.smarthq.type.thermostatmode.fanonly':          HK.OFF,
      'cloud.smarthq.type.thermostatmode.dry':              HK.COOL,
    };
    this.hkToMode = {
      [HK.OFF]:  'cloud.smarthq.type.thermostatmode.fanonly',
      [HK.COOL]: 'cloud.smarthq.type.thermostatmode.cool',
      [HK.HEAT]: 'cloud.smarthq.type.thermostatmode.cool',
      [HK.AUTO]: 'cloud.smarthq.type.thermostatmode.cool.energysaver',
    };

    // Seed initial state from service data at startup
    const thermoSvc = this.findService('cloud.smarthq.service.thermostat.v1', 'cloud.smarthq.domain.thermostat');
    if (thermoSvc?.state) {
      if (thermoSvc.state.coolCelsiusConverted != null) this.targetCelsius  = thermoSvc.state.coolCelsiusConverted as number;
      if (thermoSvc.state.mode != null)                 this.targetMode     = thermoSvc.state.mode as string;

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

      if (thermoSvc.state.on != null) this.isOn = thermoSvc.state.on as boolean;
    }

    this.setupWebSocket();

    this.client.on('service_update', (message: ServiceMessage) => {
      if (message.domainType === 'cloud.smarthq.domain.thermostat') {

        if (message.state?.on !== undefined) {
          this.isOn = message.state.on as boolean;
          this.acFan.getCharacteristic(this.Characteristic.On).updateValue(this.isOn);
        }

        if (message.state?.coolCelsiusConverted !== undefined) {
          this.targetCelsius = message.state.coolCelsiusConverted as number;
          this.acThermostat.getCharacteristic(this.Characteristic.TargetTemperature).updateValue(this.targetCelsius);
        }

        if (message.state?.mode !== undefined) {
          this.targetMode = message.state.mode as string;
          const hkMode = this.modeToHK[this.targetMode] ?? HK.COOL;
          this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).updateValue(hkMode);
          this.updateModeSwitches(this.targetMode);
        }

        if (message.state?.fanSpeed != null) {
          const incoming = message.state.fanSpeed as string;

          if (incoming === 'cloud.smarthq.type.fanspeed.auto') {
            this.targetFanState = 'AUTO';
            this.acFan.getCharacteristic(this.Characteristic.TargetFanState)
              ?.updateValue(this.Characteristic.TargetFanState.AUTO);
            return;
          }

          // Manual mode update from device
          this.targetFanState = 'MANUAL';
          this.targetFanSpeed = incoming;
          this.lastManualFanSpeed = incoming;

          this.acFan.getCharacteristic(this.Characteristic.TargetFanState)
            ?.updateValue(this.Characteristic.TargetFanState.MANUAL);

          this.acFan.getCharacteristic(this.Characteristic.RotationSpeed)
            .updateValue(this.fanSpeedToPercent(incoming));
        }
      }
    });

    // ── Accessory information ────────────────────────────────────────────────
    this.accessory.getService(this.Service.AccessoryInformation)!
      .setCharacteristic(this.Characteristic.Manufacturer,  'GE')
      .setCharacteristic(this.Characteristic.Model,         accessory.context.device.model  || 'AHTT08BC')
      .setCharacteristic(this.Characteristic.SerialNumber,  accessory.context.device.serial || 'Default-Serial');

    // ── Thermostat service ───────────────────────────────────────────────────
    const displayName  = 'Air Conditioner';
    this.acThermostat = this.accessory.getService(displayName)
      || this.accessory.addService(this.Service.Thermostat, displayName, 'ac-thermo1');

    this.acThermostat.setCharacteristic(this.Characteristic.Name, displayName);

    this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    // ── Fan service ───────────────────────────────────────────────────────────
    const fanDisplayName = 'AC Fan Speed';
    this.acFan = this.accessory.getService(fanDisplayName)
      || this.accessory.addService(this.Service.Fan, fanDisplayName, 'ac-fan1');

    this.acFan.setCharacteristic(this.Characteristic.Name, fanDisplayName);

    // Target Fan State (AUTO / MANUAL)
    this.acFan.getCharacteristic(this.Characteristic.TargetFanState)
      .onGet(() => {
        return this.targetFanState === 'AUTO'
          ? this.Characteristic.TargetFanState.AUTO
          : this.Characteristic.TargetFanState.MANUAL;
      })
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

        if (this.targetFanState === 'AUTO') {
          this.targetFanState = 'MANUAL';
        }

        this.targetFanSpeed = this.percentToFanSpeed(value as number);
        this.lastManualFanSpeed = this.targetFanSpeed;

        await this.sendThermostatCommand(
          this.targetMode,
          this.targetCelsius,
          this.targetFanSpeed,
          this.isOn,
        );
      });

    // ── Mode switches ─────────────────────────────────────────────────────────
    const modes: { name: string; mode: string; subtype: string }[] = [
      { name: 'Cool',     mode: 'cloud.smarthq.type.thermostatmode.cool',             subtype: 'ac-mode-cool'    },
      { name: 'Eco',      mode: 'cloud.smarthq.type.thermostatmode.cool.energysaver', subtype: 'ac-mode-eco'     },
      { name: 'Dry',      mode: 'cloud.smarthq.type.thermostatmode.dry',              subtype: 'ac-mode-dry'     },
      { name: 'Fan Only', mode: 'cloud.smarthq.type.thermostatmode.fanonly',          subtype: 'ac-mode-fanonly' },
    ];

    for (const { name, mode, subtype } of modes) {
      const svc = this.accessory.getService(name)
        || this.accessory.addService(this.Service.Switch, name, subtype);

      svc.setCharacteristic(this.Characteristic.Name, name);

      svc.getCharacteristic(this.Characteristic.On)
        .onGet(() => this.isOn && this.targetMode === mode)
        .onSet(async (value: CharacteristicValue) => {
          if (value) {
            this.isOn = true;
            this.targetMode = mode;

            await this.sendThermostatCommand(mode, this.targetCelsius, this.targetFanSpeed, true);
            this.updateModeSwitches(mode);

            const hkMode = this.modeToHK[mode] ?? HK.COOL;
            this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).updateValue(hkMode);
          } else {
            this.isOn = false;

            await this.sendThermostatCommand(this.targetMode, this.targetCelsius, this.targetFanSpeed, false);
            this.updateModeSwitches('');
          }
        });

      this.modeSwitches[mode] = svc;
    }

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
      svc.getCharacteristic(this.Characteristic.On).updateValue(this.isOn && mode === activeMode);
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

  private async sendThermostatCommand(mode: string, celsius: number, fanSpeed: string, on: boolean) {
    const svc = this.findService('cloud.smarthq.service.thermostat.v1', 'cloud.smarthq.domain.thermostat');
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
      serviceType: 'cloud.smarthq.service.thermostat.v1',
      domainType: 'cloud.smarthq.domain.thermostat',
    });
  }

  private findService(serviceType: string, domainType: string): DeviceService | undefined {
    return this.deviceServices.find(
      s => s.serviceType === serviceType && s.domainType === domainType,
    );
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
