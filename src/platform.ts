
import { API, Logging, PlatformConfig, PlatformAccessory, Service, Characteristic } from 'homebridge';
import chalk      from 'chalk';
import express    from 'express';
import fs         from 'fs';
import path       from 'path';
import { stringify, parse }   from 'querystring';
import { SmartHqApi }         from './smartHqApi.js';
import { EventEmitter }       from 'node:events';
import { PLATFORM_NAME, PLUGIN_NAME, AUTH_URL, TOKEN_STORE } from './settings.js';
import { setupRefrigeratorServices }   from './refrigeratorServices.js';
import { DevDevice, DevService } from './smarthq-types.js';
import { Server } from 'node:http';

export class SmartHqPlatform {
  public readonly Service: typeof Service;
  public readonly Characteristic: typeof Characteristic;

  // this is used to track restored cached accessories
  public readonly accessories: Map<string, PlatformAccessory> = new Map();
  public readonly discoveredCacheUUIDs: string[] = [];
  public readonly tokenPath: string;
  private oauthServer?: Server;
  public expires: number;
  public readonly smartHqApi: SmartHqApi;
  public authEmitter: EventEmitter
  public serviceDeviceType: string = ''
  public serviceType: string = ''

  constructor(
    public readonly log: Logging,
    public readonly config: PlatformConfig,
    private readonly api: API
  ) {
    this.api = api; 
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.expires = 0;

    this.tokenPath = path.join(
      this.api.user.persistPath(),
      TOKEN_STORE
    );

    
    this.authEmitter = new EventEmitter();

    chalk.level = 1; // Enable chalk colors

    this.smartHqApi = new SmartHqApi(this);

    // Validate required configuration parameters
    if (!config.clientId || !config.clientSecret || !config.redirectUri) {
      this.log.error('Missing required config parameter.');
      return;
    }

    this.api.on('didFinishLaunching', async () => {
      try {
        this.debug('red', '(SmartHQ OAuth2 authentication starting)');
        await this.startOAuth();
        this.debug('blue', '(SmartHQ OAuth2 authentication completed)');
      } catch (error) {
          this.log.error(chalk.red('SmartHQ OAuth2 authentication failed:'), error);
      }
    });

    // Listen for authComplete event to start device discovery
    this.authEmitter.on('authComplete', async () => {
      this.debug('green', 'Auth complete event received, starting device discovery');
      await this.discoverDevices();
    });
  }

  /**================================================================
   * If no token file exists, start the OAuth process.
   * In this process, we start a local express server to handle the redirect
   * from the SmartHQ authorization endpoint.
   * When the user clicks the link in Homebridge UI, they will be directed to the /login route
   * which will redirect to SmartHQ authorization endpoint to obtain authorization code.
   * After user login, SmartHQ authorization endpoint will redirect to whatever url:port/path was configured
   * with authorization code in the query parameter.
   * We will use this code to obtain access token and refresh token
   *================================================================*/
  
  async startOAuth() {
    const path: string = this.tokenPath;

    if (!fs.existsSync(path)) {
      this.debug('blue', '=== file does not exist starting OAuth process ===');
      this.debug('red', ' Starting localhost server to handle OAuth redirects');
    } else {
      this.debug('red', ' Returning because token path exists, emitting authComplete');
      this.authEmitter.emit('authComplete');
      return;
    }
    
    const url = new URL(this.config.redirectUri);
    const pathname: string = url.pathname;
    const port: number = parseInt(url.port, 10);
    this.debug('blue', ' Redirect URI port: ' + port + ' , ' + pathname);

    const app = express();

    // By clicking on the link in Homebridge UI (Logs), user will be directed to the /login route
    // which will redirect to SmartHQ authorization endpoint to obtain authorization code

    this.log.info(chalk.blue("======================================================================="));
    this.log.info("Click to login for SmartHQ Auth setup ===>: " + chalk.red("http://localhost:" + port + "/login"));
    this.log.info(chalk.blue("======================================================================="));


    // Clicking above link in Homebridge UI will redirect to SmartHQ authorization endpoint 

    app.get('/login', async (_req, res) => {

      try {

        const url = AUTH_URL + '?' + stringify({
          response_type: 'code',
          client_id: this.config.clientId,
          redirect_uri: this.config.redirectUri
        });

        this.debug('blue', "Redirecting to: " + url);
        res.redirect(url);     ///====> Redirect to SmartHQ authorization endpoint

      } catch (error) {
        this.log.error('SmartHQ /login error:', error);
        res.status(500).send('Authentication /login failed: ' + error);};
    });

    // After user login, SmartHQ authorization endpoint will redirect to whatever url:port/path was configured
    // with authorization code in the query parameter.
    // We will use this code to obtain access token and refresh token

    app.get(pathname, async (req, res) => {
      try {
        // Parse the request URL
        const query = parse(req.url!.split('?')[1]);

        const code = query.code?.toString() || '';
        this.debug('blue', 'An authorization code was returned: ' + code);
        this.debug('blue', 'Now exchanging code for access token...');
        if (!code) {
          this.log.error('No code found in callback URL for SmartHQ OAuth');
        }

        await this.smartHqApi.exchangeCodeForToken(code);

        res.send(`
          <h2>SmartHQ Connected</h2>
          <p>Authorization token saved to file.</p>
          <p>You may close this window.</p>
        `);
        // Emit event to indicate authentication is complete
        this.authEmitter.emit('authComplete');

        this.log.success('SmartHQ authentication completed');

        setTimeout(() => this.oauthServer?.close(), 1000);
        this.debug('blue', 'OAuth server has been closed.');
        return;

      } catch (error) {
        this.log.error('SmartHQ OAuth failed', error);
        res.status(500).send('Authentication failed: ' + error);
      }
    });

    this.oauthServer = app.listen(port, () => {
      this.log.info(`SmartHQ OAuth listening on ${port}`);
    });
  }

  // Extract port and pathname from redirect URI

  extractPortFromRedirectUri(redirectUri: string): { port: number; pathname: string } {
    const url = new URL(redirectUri);
    const pathname: string = url.pathname;
    const port: number = parseInt(url.port, 10);
    return { port, pathname };
  }


  configureAccessory(accessory: PlatformAccessory) {
    this.log.info('Loading accessory from cache:', accessory.displayName);

    // add the restored accessory to the accessories cache, so we can track if it has already been registered
    this.accessories.set(accessory.UUID, accessory);
  }
  

  private async discoverDevices() {
    this.debug('yellow', '(discoverDevices) Starting device discovery...'); 
    let devices: DevDevice[] = [];
    devices =  await this.smartHqApi.getAppliances();
    
    // loop over the discovered devices and register each one if it has not already been registered
    
    if (!devices || devices.length === 0) {
      this.log.warn(chalk.yellow('No SmartHQ devices found for this account.'));
      return;
    } 
    for (const device of devices) {
      this.log.info(chalk.yellow(`SmartHQ Discovered device: ${device.nickname} Model: ${device.model}`));

      // Used to acquire service IDs and service deviceTypes for deviceServiceState queries
      const deviceServices =  await this.smartHqApi.getDeviceServices(device.deviceId);

      let accessoryType: PlatformAccessory | undefined;
      
      const uuid = this.api.hap.uuid.generate(device.deviceId);
      const existingAccessory = this.accessories.get(uuid);

      // for existing accessories restore from cache

      if (existingAccessory) {
        this.log.info('Restoring existing accessory from cache:', existingAccessory.displayName);
        accessoryType = existingAccessory;
        existingAccessory.context.device = device;
        this.api.updatePlatformAccessories([existingAccessory]);
      } else {

      // create new accessory

        this.log.info('Adding new accessory:', device.nickname);
        const accessory = new this.api.platformAccessory(device.nickname, uuid);
        accessoryType = accessory;

        accessory.context.device = device;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      this.discoveredCacheUUIDs.push(uuid);

      // Setup services based on device type when there are multiple device types in account
      // add more case statements e.g. Washer, Dryer, Oven, etc.

      switch (device.nickname) {
        case 'Refrigerator':
          this.debug('green', `Setting up Refrigerator services for ${device.nickname}`);
          setupRefrigeratorServices.call(this, accessoryType, device, deviceServices);
          break;
        case 'someNewAppliance':
          this.debug('green', `Logic not implemented for ${device.nickname}`);
          break;
        default:
          this.debug('red', `not implemented device :  for device ${device.nickname}`);
      }
    }

    // remove accessories from the cache which are no longer present
    
    for (const [uuid, accessory] of this.accessories) {
      if (!this.discoveredCacheUUIDs.includes(uuid)) {
        this.log.info('Removing existing accessory from cache:', accessory.displayName);
        this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
    }
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

  // Some models may not have all services available so don't add service if not supported
  
  public deviceSupportsThisService(deviceServices: DevService[], 
                                serviceDeviceType: string, 
                                serviceType: string,
                                domainType: string): boolean {
    for (const service of deviceServices) {
      if (service.serviceDeviceType === serviceDeviceType 
        && service.serviceType      === serviceType
        && service.domainType       === domainType) {
        return true;
      }
    }
    return false;
  } 
}