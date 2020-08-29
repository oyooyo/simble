# simble

A *node.js* module for **sim**ple access to **ble** (Bluetooth Low Energy = Bluetooth 4.x) devices.

This module is a wrapper for the [*noble*](https://www.npmjs.com/package/@abandonware/noble) package, using Promises instead of callbacks and providing a somewhat different API.

## Usage example

The following code scans for a nearby Bluetooth LE peripheral that advertises the ["Heart Rate" Service (ID: 0x180D)](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.heart_rate.xml). If such a peripheral is found, it requests the peripheral's ["Heart Rate Measurement" Characteristic (ID: 0x2A37)](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.characteristic.heart_rate_measurement.xml) *(the peripheral will auto-connect, since a connection is required for accessing/requesting a Characteristic)*. It then subscribes to that characteristic; whenever updates arrive, it will print the current heart rate (byte 1 in the data) to the console.

    require('simble').subscribe_to_characteristic(0x180D, 0x2A37, (heart_rate_data) => {
      console.log(`Heart rate: ${data[1]} bpm`);
    });

## API

Unfortunately, the API is not documented yet, so there's very little reason for others to use it yet. I published it because other node.js modules of mine require it.
