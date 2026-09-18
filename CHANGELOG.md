## [1.3.1](https://github.com/ceb400/homebridge-smarthq-client/compare/v1.3.0...v1.3.1) (2026-09-18)


### Bug Fixes

* :bug: dishwasher options initialized wrong ([ee59785](https://github.com/ceb400/homebridge-smarthq-client/commit/ee59785bbdc33a7373a8d0dfe0b766f0101ac1e2))
* :bug: Fix Dishwasher Cleaning mode error.  Replace Cycle Pct Done with new Time remaining ([a1738bb](https://github.com/ceb400/homebridge-smarthq-client/commit/a1738bbe3e36217c0476d89ffcbe1f5682909776))

# Changelog

All notable changes to this project will be documented in this file.

## [1.3.0](https://github.com/ceb400/homebridge-smarthq-client/compare/v1.2.10...v1.3.0) (2026-09-14)
- Add support for dehumidifier with configurable range for min and max humidity
- Add feature to allow exclusion of individual device types so no services for that type are created
and if device is excluded remove old UUIDs from cache.
- Fix refrigerator.ts to remove UUID from cache for individual service disabled in config file
- Fix dishwasher.ts to remove UUID from cache for individual service disabled in config file

## [1.2.10](https://github.com/ceb400/homebridge-smarthq-client/compare/v1.2.9...v1.2.10) (2026-08-27)


### Bug Fixes

* :bug: fix: unhandled error in waterfilter.ts ([4a2a3cc](https://github.com/ceb400/homebridge-smarthq-client/commit/4a2a3cc2512c2bd699a9e8f9268af794e6d2ba91))

## [1.2.9](https://github.com/ceb400/homebridge-smarthq-client/compare/v1.2.8...v1.2.9) (2026-08-26)


### Bug Fixes

* :bug: fix: plugin hangs if error occurs in device discovery ([56d1c06](https://github.com/ceb400/homebridge-smarthq-client/commit/56d1c0604483ccb9b0837cdf19b977a1c802f3d7))

## [1.2.8](https://github.com/ceb400/homebridge-smarthq-client/compare/v1.2.7...v1.2.8) (2026-08-24)


### Bug Fixes

* setup for automated workflows ([cb9e52c](https://github.com/ceb400/homebridge-smarthq-client/commit/cb9e52cc9c9cb7da17f4fb893e797b4ddae22ceb))





## [1.2.7](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.7) (2026-08-24)
- Use original ge-smarthq library now that it is being maintained 
- implement workflows to automate versioning

## [1.2.6](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.6) (2026-07-19)
- Handle cases for: 
- **FanOnly** mode does not allow FanSpeed mode of Auto
- Setting mode to **Dry** will set FanSpeed mode of Low
- In mode **FanOnly** when user changes Temperature, the mode will be switched to **Cool** and temp change will apply
- Decrease amount of log messages in debug mode
- Improve error handling routines

## [1.2.5](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.5) (2026-07-15)
- Merge beta branch into main branch



## [1.2.5-beta.6](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.5) (2026-07-08)
- Air conditioner updates to dynamically add only modes and fan speeds for each specific model.
- AC Modes and AC Fan Speeds tiles in Apple Home will open to show choices for modes and speeds.

## [1.2.2](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.2) (2026-07-02)
- Bug fix for device discovery (checking device.nickname includes substring)

## What's Changed
## [1.2.0](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.2.0) (2026-07-01)
- Added initial support for air conditioner
- minor bug fixes to correct invalid name error

## What's Changed

## [1.1.1](https://github.com/ceb400/homebridge-smarthq-client/releases/tag/v1.1.1) (2026-04-25)

## What's Changed
- Changed some log.info msgs to debug level to eliminate some normal log messages


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
