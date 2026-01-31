import axios, { AxiosError } from 'axios';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { stringify } from 'querystring';
import chalk from 'chalk';

import { API_URL, AUTH_URL, ACCESSTOKEN_URL} from './settings.js';
import { SmartHqPlatform } from './platform.js';

/**
 * SmartHq Api functions         
 * This class is the main constructor for your plugin, this is where you should
 * parse the user config and discover/register accessories with Homebridge.
 */
/* ---------- SmartHq Api ---------- */

export class SmartHqApi {
  refresh_token: string;
  expires: number;
  access_token: string;

  constructor(
    private readonly platform: SmartHqPlatform,
  ) {
    this.refresh_token = '';
    this.access_token = '';
    this.expires = 0;
    this.loadAccessToken();
  }


  //-------------------------------------------------------------
  // Create the url to be displayed in Homebridge log for first time
  // user to visit the link and login successfully.
  // Response will be sent to redirect uri
  //-------------------------------------------------------------
  authUrl() {
    return AUTH_URL + stringify({
      response_type: 'code',
      client_id: this.platform.config.clientId,
      redirect_uri: this.platform.config.redirectUri
    });
  }

  async getOauthAccessToken(dataForBody: Record<string, string>) {
    try {
      const response = await axios.post(
        ACCESSTOKEN_URL,
        stringify(dataForBody),
        { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
      );
     
      this.saveToken(response.data);
    } catch (error: AxiosError | any) {
      // Use isAxiosError type guard for safe property access
      if (axios.isAxiosError(error)) {
        if (error.response) {
          switch (error.response.status) {
            case 400:
              this.platform.log.error('(400) Bad Request: The request is missing required parameters or includes invalid values.');
              break;
            case 401:
              this.platform.log.error('(401) Unauthorized – The provided client credentials are invalid.: ');
              break;
            default:
              this.platform.log.error('Error obtaining token: ', error.message);
              break;
          }
        }
      } else {
        // Not an Axios error (e.g., a general JavaScript error)
        console.error('Unexpected error:', error);
      }
    }
  }

  async exchangeCodeForToken(code: string) {
    return this.getOauthAccessToken({
      grant_type: 'authorization_code',
      client_id: this.platform.config.clientId,
      client_secret: this.platform.config.clientSecret,
      redirect_uri: this.platform.config.redirectUri,
      code: code
    });
  }

  async refreshAccessToken() {
    return this.getOauthAccessToken({
      grant_type: 'refresh_token',
      client_id: this.platform.config.clientId,
      client_secret: this.platform.config.clientSecret,
      refresh_token: this.refresh_token
    });
  }

  saveToken(data: any) {
    Object.assign(this, data);
    
    this.expires = Date.now() + data.expires_in * 1000;
    try {
      writeFileSync(this.platform.tokenPath, JSON.stringify(data, null, 2));
    } catch (error: any) {
      this.platform.log.error('Error saving token: ', error.message);
    }
  }

  loadAccessToken() {
    if (!existsSync(this.platform.tokenPath)) return;
    const data: string = readFileSync(this.platform.tokenPath).toString('utf8');
    const tokenData = JSON.parse(data);
    Object.assign(this, tokenData);
    this.expires = Date.now() + tokenData.expires_in * 1000;
  }

  async httpHeaders() {
    if (!this.access_token || Date.now() > this.expires - 60000) {
      await this.refreshAccessToken();
    }
    return { Authorization: `Bearer ${this.access_token}` };
  }
  
  async getAppliances() {
    //======================================================
    // Get list of devices for your account
    //======================================================
      this.debug('green', 'Entering getAppliances()');
    
    const url = new URL('/v2/device', API_URL);
    try {
      const res = await axios.get(url.toString(),
        { headers: await this.httpHeaders() }
      );
      return res.data.devices;
    } catch (error: AxiosError | any) {
      if (error.response) {
        switch (error.response.status) {
          case 400:
            this.platform.log.error('(400) Bad Request: ', error.message);
            break;
          case 401:
            this.refreshAccessToken();
            //this.platform.log.error('(401) Unauthorized: ', error.message);   token expired - refresh token instead of error
            break;
          case 403:
            this.platform.log.error('(403) Forbidden client does not have permission to view device: ', error.message);
            break;
          default:
            this.platform.log.error('Error in getAppliances(): ', error.message);
            break;
        }
      }  else {
        this.debug('red', ('Still here too early.'));
      }
    }
  }

  async getServiceState(deviceId: string, serviceId: string) {
    //======================================================
    // Get the state of the service        
    //======================================================
    const url = new URL(`/v2/device/${deviceId}/service/${serviceId}`, API_URL);
    try {
      const response = await axios.get(url.toString(),
        { headers: await this.httpHeaders() }
      );
      if (!response.data) {
        this.platform.log.error(
          `Request ${url} failed with status ${response.status}`
        );
        return;
      }
      return response.data.state;
      
    } catch (error: AxiosError | any) {
      if (error.response && error.response.status === 401) {
        await this.refreshAccessToken();
        this.debug('red', 'Token refreshed in getServiceState.');
      }
    }
  }

  async getDeviceServices(deviceId: string) {
    const url = new URL(`/v2/device/${deviceId}`, API_URL);
    try {
        const response = await axios.get(url.toString(),
          { headers: await this.httpHeaders() }
        );
        const sortedServices = response.data.services.sort((a: any, b: any) => {
          if (a.serviceDeviceType < b.serviceDeviceType) return -1;
          if (a.serviceDeviceType > b.serviceDeviceType) return 1;
          return 0;
        });

        if (this.platform.config.debugServices) {
          this.platform.log.info(chalk.red("(The 'state' of each service can be queried using getServiceState() in smartHQApi.js)"));
          for (const service of sortedServices) {
            this.platform.log.info(chalk.yellow("ServiceDeviceType = " + service.serviceDeviceType));
            this.platform.log.info(chalk.yellow("ServiceType       = " + service.serviceType));
            this.platform.log.info(chalk.yellow("Domain            = " + service.domainType));
            this.platform.log.info(chalk.yellow("Valid Commands    = " + chalk.green(JSON.stringify(service.supportedCommands))));
            this.platform.log.info(chalk.yellow("Config            = " + chalk.green(JSON.stringify(service.config))));
            this.platform.log.info(chalk.yellow("State             = " + chalk.red(JSON.stringify(service.state))));
            this.platform.log.info("------------------------------------------------------------------------");
          }
        }
        if (!response.data) {
          this.platform.log.error(
            `Request ${url} failed with status ${response.status}`
          );
          return;
        }
        return response.data.services;
    } catch (error: AxiosError | any) {
      if (error.response && error.response.status === 401) {
        await this.refreshAccessToken();
        this.debug('red', 'Token refreshed in getDeviceServices.');
      } else {
        this.platform.log.error('Error from getDeviceServices():', + error.message);
      }
    }
  }
 async getRecentAlerts() {
    // Check for alerts every minute
    const urlAlert = new URL(`/v2/alert/recent?after=1m`, API_URL);

    try {
        const res = await axios.get(urlAlert.toString(),
          { headers: await this.httpHeaders() }
        );
        return res.data.alerts;

    } catch (error: AxiosError | any) {
      if (error.response && error.response.status === 401) {
        await this.refreshAccessToken();
        this.debug('red', 'Token refreshed in getDeviceServices.');
      } else {
        this.platform.log.error('Error getting recent alerts:', + error.message);
      }
    } 
  }

  async command(body: string) {

    const url = new URL('/v2/command', API_URL);

    try {
      const response = await axios.post(url.toString(), 
        body,
        { headers: await this.httpHeaders() }
      );
      return response.data;

    } catch (error: AxiosError | any) {
      if (error.response && error.response.status === 401) {
        await this.refreshAccessToken();
        this.debug('red', 'Token refreshed in command.');
      } else {
        this.platform.log.error('Error sending command:', body);
        if (error.response) {
          // The request was made and the server responded with a status code
          // that falls out of the range of 2xx
          this.platform.log(error.response.data);
        }
      }
  }
}

// Use chalk to color debug messages (local to this plugin)
// only show debug messages if debugLogging is enabled in config

debug(color: string, message: string) {
    if (this.platform.config.debugLogging) {
      switch(color) {
        case 'red':
          this.platform.log.info(chalk.red('[SmartHQ] ' + message));
          break;
        case 'blue':
          this.platform.log.info(chalk.blue('[SmartHQ] ' + message));
          break;
        case 'green':
          this.platform.log.info(chalk.green('[SmartHQ] ' + message));
          break;
        case 'yellow':
          this.platform.log.info(chalk.yellow('[SmartHQ] ' + message));
          break;
        default:
          this.platform.log.info('[SmartHQ] ' + message);
      }
    }  
  }

}