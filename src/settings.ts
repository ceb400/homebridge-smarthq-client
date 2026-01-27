/**
 * This is the name of the platform that users will use to register the plugin in the Homebridge config.json
 */
export const PLATFORM_NAME = "SmartHqPlatform";

/**
 * This must match the name of your plugin as defined the package.json `name` property
 */
export const PLUGIN_NAME = 'homebridge-smarthq-client';
export const API_URL =     'https://client.mysmarthq.com';

export const AUTH_URL =    'https://accounts.brillion.geappliances.com/oauth2/auth';
export const ACCESSTOKEN_URL =  'https://accounts.brillion.geappliances.com/oauth2/token';
export const TOKEN_STORE =  'smarthq.tokens.json';
