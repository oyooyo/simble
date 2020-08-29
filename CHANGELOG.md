# Changelog

## v0.2.6 *(2020/08/29)*

- Converted source code from CoffeeScript to ECMAscript

## v0.2.5 *(2019/02/25)*

- Switched underlying noble library to [abandonware fork](https://github.com/abandonware/noble) since the original noble seems to have become unmaintained
- Added some more convenience functions
- Updated the example in the README

## v0.2.4 *(2019/01/05)*

- (Hopefully) fixed some severe bugs that made simble interfere with other BLE devices

## v0.2.3 *(2018/12/25)*

- Fixed some errors in the v0.2.2 changes

## v0.2.2 *(2018/12/25)*

- Removed package-lock.json for now, because I don't fully comprehend it and that may have caused some issues
- Added some more debug messages

## v0.2.1 *(2018/09/12)*

- Some further improvements, like the ability to set auto-disconnect timeouts

## v0.2.0 *(2018/09/11)*

- Fixed a few bugs
- Improved the source code
- Removed some pointless functions
- Added some debug output (Enable with `DEBUG=simble:*`)

## v0.1.2

- Fixed bug that affected reconnecting

## v0.1.0

- Complety changed API; no longer tries to mimic Web Bluetooth

## v0.0.5

- Added `requestCharacteristics` convenience function
- Extended README

## v0.0.4

- Updated README

## v0.0.3

- First somewhat usable version.

## v0.0.1

- Initial, barely usable version.
