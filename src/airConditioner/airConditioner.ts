import { API, CharacteristicValue, PlatformAccessory, Service, Characteristic } from 'homebridge';
import { SmartHQClient, DeviceService } from 'ge-smarthq';
import { SmartHqPlatform }              from '../platform.js';
import { ServiceMessage }               from '../index.js';

export class AirConditioner {
  private targetCelsius   = 22.22;
  private targetMode      = 'cloud.smarthq.type.thermostatmode.cool';
  private targetFanSpeed  = 'cloud.smarthq.type.fanspeed.auto';
  private isOn            = false;

  // Tracks whether last fan change was initiated by user or device (needed for ECO/AUTO filtering)
  private fanIntent: 'user' | 'device' = 'device';

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
      if (thermoSvc.state.fanSpeed != null)             this.targetFanSpeed = thermoSvc.state.fanSpeed as string;
      if (thermoSvc.state.on != null)                   this.isOn           = thermoSvc.state.on as boolean;
    }

    // authenticate() before connect() so both sendCommand and WebSocket work
    this.setupWebSocket();

    // WebSocket push updates
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

          // FAN SPEED SYNC LOGIC (UPDATED)
        if (message.state?.fanSpeed != null) {

          const incoming = message.state.fanSpeed as string;

          if (incoming === this.targetFanSpeed) return;

          const incomingPercent = this.fanSpeedToPercent(incoming);
          const currentPercent = this.fanSpeedToPercent(this.targetFanSpeed);
          const delta = Math.abs(incomingPercent - currentPercent);

          // Only treat small changes during ECO/AUTO as noise
          const isEcoOrAuto =
            this.targetFanSpeed === 'cloud.smarthq.type.fanspeed.auto' ||
            this.modeToHK[this.targetMode] === this.Characteristic.TargetHeatingCoolingState.AUTO;

          // Ignore automatic ECO/AUTO drift unless user changed it
          if (this.fanIntent !== 'user' && isEcoOrAuto && delta < 15) {
            return;
          }

          const old = this.targetFanSpeed;

          // Only update internal state if this was a user-driven change
         const old = this.targetFanSpeed;

            // Only update internal state if this was a user-driven change
            if (this.fanIntent === 'user') {
              this.targetFanSpeed = incoming;
            }
            
            this.acFan
              .getCharacteristic(this.Characteristic.RotationSpeed)
              .updateValue(incomingPercent);
            
            this.acFan
              .getCharacteristic(this.Characteristic.On)
              .updateValue(this.isOn);
            
            // capture intent BEFORE resetting it
            const wasUserIntent = this.fanIntent === 'user';
            
            // reset intent after confirmed sync
            this.fanIntent = 'device';
            
            if (delta >= 15 || wasUserIntent) {
              this.client.debug(`FanSpeed synced: ${old} → ${incoming}`);
          }
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
    this.acThermostat.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    this.acThermostat.setCharacteristic(this.Characteristic.ConfiguredName, displayName);

    this.acThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState).setProps({
      minValue:    this.Characteristic.CurrentHeatingCoolingState.OFF,
      maxValue:    this.Characteristic.CurrentHeatingCoolingState.COOL,
      validValues: [
        this.Characteristic.CurrentHeatingCoolingState.OFF,
        this.Characteristic.CurrentHeatingCoolingState.COOL,
      ],
    });

    this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).setProps({
      minValue:    this.Characteristic.TargetHeatingCoolingState.OFF,
      maxValue:    this.Characteristic.TargetHeatingCoolingState.AUTO,
      validValues: [
        this.Characteristic.TargetHeatingCoolingState.OFF,
        this.Characteristic.TargetHeatingCoolingState.COOL,
        this.Characteristic.TargetHeatingCoolingState.AUTO,
      ],
    });

    this.acThermostat.getCharacteristic(this.Characteristic.CurrentTemperature).setProps({
      minValue: -20,
      maxValue: 50,
      minStep:  0.1,
    });

    this.acThermostat.getCharacteristic(this.Characteristic.TargetTemperature).setProps({
      minValue: 17.78,
      maxValue: 30.0,
      minStep:  0.5,
    });

    this.acThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState)
      .onGet(this.getCurrentHeatingCoolingState.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
      .onGet(this.getTargetHeatingCoolingState.bind(this))
      .onSet(this.setTargetHeatingCoolingState.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.CurrentTemperature)
      .onGet(this.getCurrentTemperature.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.TargetTemperature)
      .onGet(this.getTargetTemperature.bind(this))
      .onSet(this.setTargetTemperature.bind(this));

    this.acThermostat.getCharacteristic(this.Characteristic.TemperatureDisplayUnits)
      .onGet(this.handleTemperatureDisplayUnitsGet.bind(this))
      .onSet(this.handleTemperatureDisplayUnitsSet.bind(this));

    // ── Fan service ───────────────────────────────────────────────────────────
    const fanDisplayName = 'AC Fan Speed';
    this.acFan = this.accessory.getService(fanDisplayName)
      || this.accessory.addService(this.Service.Fan, fanDisplayName, 'ac-fan1');

    this.acFan.setCharacteristic(this.Characteristic.Name, fanDisplayName);
    this.acFan.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
    this.acFan.setCharacteristic(this.Characteristic.ConfiguredName, fanDisplayName);

    this.acFan.getCharacteristic(this.Characteristic.On)
      .onGet(() => this.isOn)
      .onSet(async (value: CharacteristicValue) => {
        this.fanIntent = 'user';
        await this.setTargetHeatingCoolingState(
          value
            ? this.Characteristic.TargetHeatingCoolingState.COOL
            : this.Characteristic.TargetHeatingCoolingState.OFF,
        );
      });

    this.acFan.getCharacteristic(this.Characteristic.RotationSpeed)
      .setProps({ minValue: 0, maxValue: 100, minStep: 25 })
      .onGet(() => this.fanSpeedToPercent(this.targetFanSpeed))
      .onSet(async (value: CharacteristicValue) => {

        // Mark this as a USER action so SmartHQ auto-adjustments don't override HomeKit state
        this.fanIntent = 'user';

        this.targetFanSpeed = this.percentToFanSpeed(value as number);

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
      svc.addOptionalCharacteristic(this.Characteristic.ConfiguredName);
      svc.setCharacteristic(this.Characteristic.ConfiguredName, name);

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

            this.acFan.getCharacteristic(this.Characteristic.On).updateValue(true);
          } else {
            this.isOn = false;

            await this.sendThermostatCommand(this.targetMode, this.targetCelsius, this.targetFanSpeed, false);

            this.updateModeSwitches('');

            this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState)
              .updateValue(this.Characteristic.TargetHeatingCoolingState.OFF);

            this.acFan.getCharacteristic(this.Characteristic.On).updateValue(false);
          }
        });

      this.modeSwitches[mode] = svc;
    }

    // Set initial switch states
    this.updateModeSwitches(this.isOn ? this.targetMode : '');

    // ── Polling (every 30 s) ──────────────────────────────────────────────────
    setInterval(() => {
      this.getCurrentTemperature().then(temp => {
        this.acThermostat.getCharacteristic(this.Characteristic.CurrentTemperature).updateValue(temp);
      });

      this.getCurrentHeatingCoolingState().then(state => {
        const running = state === this.Characteristic.CurrentHeatingCoolingState.COOL;

        this.acThermostat.getCharacteristic(this.Characteristic.CurrentHeatingCoolingState).updateValue(state);
        this.acFan.getCharacteristic(this.Characteristic.On).updateValue(running);

        this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).updateValue(
          this.isOn
            ? (this.modeToHK[this.targetMode] ?? this.Characteristic.TargetHeatingCoolingState.COOL)
            : this.Characteristic.TargetHeatingCoolingState.OFF,
        );
      });
    }, 30000);
    }

  // ── Mode switch mutual exclusion ───────────────────────────────────────────

  private updateModeSwitches(activeMode: string) {
    for (const [mode, svc] of Object.entries(this.modeSwitches)) {
      svc.getCharacteristic(this.Characteristic.On).updateValue(this.isOn && mode === activeMode);
    }
  }

  // ── Fan speed helpers ──────────────────────────────────────────────────────

  private fanSpeedToPercent(fanSpeed: string): number {
    switch (fanSpeed) {
      case 'cloud.smarthq.type.fanspeed.high':   return 100;
      case 'cloud.smarthq.type.fanspeed.medium': return 50;
      case 'cloud.smarthq.type.fanspeed.low':    return 25;
      case 'cloud.smarthq.type.fanspeed.auto':   return 0;
      default: return this.fanSpeedToPercent(this.targetFanSpeed);
    }
  }

  private percentToFanSpeed(percent: number): string {
    if (percent >= 75) return 'cloud.smarthq.type.fanspeed.high';
    if (percent >= 40) return 'cloud.smarthq.type.fanspeed.medium';
    if (percent >= 15) return 'cloud.smarthq.type.fanspeed.low';
    return 'cloud.smarthq.type.fanspeed.auto';
  }

  // ── Shared command helper ──────────────────────────────────────────────────

  private async sendThermostatCommand(mode: string, celsius: number, fanSpeed: string, on: boolean) {
    const svc = this.findService('cloud.smarthq.service.thermostat.v1', 'cloud.smarthq.domain.thermostat');
    if (!svc) return;

    const command: Record<string, unknown> = {
      commandType: 'cloud.smarthq.command.thermostat.v1.set',
      on,
    };

    if (on) {
      command.mode = mode;

      const isDry = mode === 'cloud.smarthq.type.thermostatmode.dry';
      if (!isDry) {
        command.fanSpeed = fanSpeed;
      }

      const needsCoolTemp =
        mode === 'cloud.smarthq.type.thermostatmode.cool'
        || mode === 'cloud.smarthq.type.thermostatmode.cool.energysaver';

      if (needsCoolTemp) {
        command.coolFahrenheit = Math.round(celsius * 9 / 5 + 32);
      }
    }

    const cmdBody = {
      command,
      kind:              'service#command',
      deviceId:          this.deviceId,
      serviceDeviceType: 'cloud.smarthq.device.airconditioner',
      serviceType:       'cloud.smarthq.service.thermostat.v1',
      domainType:        'cloud.smarthq.domain.thermostat',
    };

    try {
      await this.client.sendCommand(cmdBody);
    } catch (error: unknown) {
      const resolved = error instanceof Promise ? await error : error;
      const msg = resolved instanceof Error ? resolved.message : JSON.stringify(resolved);
      this.client.debug('Error sending AC thermostat command: ' + msg);
    }
  }

  // ── Service helpers ────────────────────────────────────────────────────────

  private findService(serviceType: string, domainType: string): DeviceService | undefined {
    return this.deviceServices.find(
      s => s.serviceType === serviceType && s.domainType === domainType,
    );
  }

  // ── Handlers ──────────────────────────────────────────────────────────────

  async getCurrentHeatingCoolingState(): Promise<number> {
    const svc = this.findService(
      'cloud.smarthq.service.toggle',
      'cloud.smarthq.domain.state.compressor',
    );
    if (!svc) return this.Characteristic.CurrentHeatingCoolingState.OFF;

    try {
      const response = await this.client.getServiceDetails(this.deviceId, svc.serviceId);
      const running  = response?.state?.on as boolean ?? false;
      this.isOn      = running;
      return running
        ? this.Characteristic.CurrentHeatingCoolingState.COOL
        : this.Characteristic.CurrentHeatingCoolingState.OFF;
    } catch (error) {
      this.client.debug('Error getting AC compressor state: ' + error);
      return this.Characteristic.CurrentHeatingCoolingState.OFF;
    }
  }

  getTargetHeatingCoolingState(): number {
    if (!this.isOn) return this.Characteristic.TargetHeatingCoolingState.OFF;
    return this.modeToHK[this.targetMode] ?? this.Characteristic.TargetHeatingCoolingState.COOL;
  }

  async setTargetHeatingCoolingState(value: CharacteristicValue) {
    const hkValue = value as number;
    const HK = this.Characteristic.TargetHeatingCoolingState;

    if (hkValue === HK.OFF) {
      this.isOn = false;
      await this.sendThermostatCommand(this.targetMode, this.targetCelsius, this.targetFanSpeed, false);
      this.updateModeSwitches('');
      this.acThermostat.getCharacteristic(this.Characteristic.TargetHeatingCoolingState).updateValue(HK.OFF);
      return;
    }

    this.isOn = true;
    const newMode = this.hkToMode[hkValue] ?? 'cloud.smarthq.type.thermostatmode.cool';
    this.targetMode = newMode;
    await this.sendThermostatCommand(newMode, this.targetCelsius, this.targetFanSpeed, true);
    this.updateModeSwitches(newMode);
  }

  async getCurrentTemperature(): Promise<number> {
    const svc = this.findService(
      'cloud.smarthq.service.temperature',
      'cloud.smarthq.domain.indoor.ambient',
    );
    if (!svc) return this.targetCelsius;

    try {
      const response = await this.client.getServiceDetails(this.deviceId, svc.serviceId);
      if (response?.state?.celsiusConverted == null) return this.targetCelsius;
      return Number(response.state.celsiusConverted);
    } catch (error) {
      this.client.debug('Error getting AC current temperature: ' + error);
      return this.targetCelsius;
    }
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
    this.client.debug('AC Temperature Display Units set to: ' + value);
  }

  async setupWebSocket() {
    try {
      await this.client.authenticate();
      await this.client.connect();
    } catch (error) {
      this.client.debug('Failed to connect to SmartHQ WebSocket for AC: ' + error);
    }
  }
}
