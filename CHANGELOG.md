# Changelog

All notable changes to this project will be documented in this file.

## [1.1.0](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.1.0) (2026-04-25)

## What's Changed
- Changed to use pkg *'ge-smarthq'*   for all API calls + Oauth2 authentication, token handling and web socket
- Changed refrigerator alert handling from a polling interval to monitoring via web sockets.
- added initial support for dishwasher 
- updated config.schema.json to include dishwasher and additional debug logging

**Full Changelog**: https://github.com/ceb400/homebridge-smarthq-client/compare/...v1.1.0

## [1.0.3](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.0.3) (2026-02-11)

## What's Changed
- Patch for undefined value for targetheattingcooling threshold
- added a lightbulb Brightness characteristic to display level for water filter pct remaining 

**Full Changelog**: https://github.com/ceb400/homebridge-smarthq-client/compare/...v1.0.2

## [1.0.2](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.0.2) (2026-02-03)

## What's Changed
* No notable changes


## [1.0.1](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.0.1) (2026-02-02)

## What's Changed
- Corrected non-unique display name
- Updated Readme.md
- Create License
- Updated email


**Full Changelog**: https://github.com/ceb400/homebridge-smarthq-client/compare/...v1.0.1

## [1.0.0](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.0.0) (2026-01-31)

## What's Changed
- Initial release of Homebridge GE SmartHQ
- Controls for GE refrigerators
- OAuth2 authentication with automatic token refresh
- Device discovery and management
- Service state queries and updates
- Command execution
- Alert monitoring

**Full Changelog**: https://github.com/ceb400/homebridge-smarthq-client/compare/...v1.0.0


