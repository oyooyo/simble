simble
======

A *node.js* module for **sim**ple access to **ble** (Bluetooth Low Energy = Bluetooth 4.x) devices.

*simble* tries to provide a *Web Bluetooth API*-like interface to sandeepmistry's great [*noble*](https://www.npmjs.com/package/noble) package.
Additionally, *simble* introduces a few useful helper functions for common tasks, meant to further simplify and shorten the code required to access Bluetooth 4.x-devices.

Usage
-----

Here's a short example of using *simble*. The following code will try to connect to any nearby Bluetooth LE device offering the [GATT service with assigned number *0x180D* ("Heart Rate")](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.heart_rate.xml), and then request access to the [GATT characteristic with assigned number *0x2A37* ("Heart Rate Measurement")](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.characteristic.heart_rate_measurement.xml).
This GATT characteristic will then be *subscribed to*, by passing a callback function that will be called whenever there is new heart rate measurement data available.
That callback function simply prints the current heart rate (stored in the second byte of the characteristic's data) to the console.

```
bluetooth = require('simble');

bluetooth.requestCharacteristic(0x2A37, 0x180D)
.then(characteristic => {
	characteristic.subscribe(event => {
		console.log('Heart Rate: ' + event.target.value[1]);
	});
});
```
