# simble
A *node.js* module for **sim**ple access to **ble** (Bluetooth Low Energy = Bluetooth 4.x) devices.

## Features

### *Web Bluetooth API*-like interface for node.js/noble
When it comes to communicating with Bluetooth 4.x devices via Javascript, I believe there are currently two important APIs:

- For webbrowser/client-side Javascript: The [*Web Bluetooth API*](https://developers.google.com/web/updates/2015/07/interact-with-ble-devices-on-the-web)
- For node.js/server-side Javascript: sandeepmistry's great [*noble*](https://www.npmjs.com/package/noble) package

I have used (and like) both APIs. But I don't quite like the idea of programming against two different Javascript APIs, one for the browser, one for node.js, I'd prefer to use the same Javascript code for communicating with Bluetooth LE devices in both the browser and node.js.

While *noble* uses the traditional node.js-approach of callback functions, the newer *Web Bluetooth API* chose the modern approach of Javascript Promises, which I personally prefer.
So I decided to write a little wrapper for *noble* that would allow me to program against a *Web Bluetooth API*-like interface in node.js as well.

### Helpful convenience functions
The *Web Bluetooth API* already makes communicating with Bluetooth LE devices very easy and often just a matter or a few dozen lines of code.
But my code for communicating with some Bluetooth LE device usually starts with the same sequence of steps:

1. Look/Scan for the Bluetooth LE *peripheral* to connect to
2. Connect to that *peripheral*
3. Request a specific (GATT-) *service* from the peripheral
4. Request one or more (GATT-) *characteristics* from that *service*

I realized that I could further shorten my code by introducing some convenience functions that would accomplish several of these steps in one single function call.

## Documentation

### Web Bluetooth API

There is hardly any API documentation here right now, so *simble* probably isn't very useful just yet.

But since *simble* aims to provide a *Web Bluetooth API*-like interface for node.js, it may be sufficient to simply read some other documentation about *Web Bluetooth*.

The best place to get started with the *Web Bluetooth API* currently probably is [this short tutorial by Google](https://developers.google.com/web/updates/2015/07/interact-with-ble-devices-on-the-web). Ideally, all the examples in that tutorial should just as well work with *simble* (I don't know if they do, they probably don't, I haven't actually tried). The only necessary change would be that all occurences of `navigator.bluetooth` need to be replaced by `require('simble')`

## Usage examples

### Log data from a *heart rate* sensor using the *requestCharacteristic* convenience function

Here's a short example of using *simble*. The following code will try to connect to any nearby Bluetooth LE device offering the [GATT service with assigned number *0x180D* ("Heart Rate")](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.service.heart_rate.xml), and then request access to the [GATT characteristic with assigned number *0x2A37* ("Heart Rate Measurement")](https://www.bluetooth.com/specifications/gatt/viewer?attributeXmlFile=org.bluetooth.characteristic.heart_rate_measurement.xml).
This GATT characteristic will then be *subscribed to*, by passing a callback function that will be called whenever there is new heart rate measurement data available.
That callback function simply prints the current heart rate (stored in the second byte of the characteristic's data) to the console.

	bluetooth = require('simble');

	bluetooth.requestCharacteristic(0x2A37, 0x180D)
	.then(characteristic => {
		characteristic.subscribe(event => {
			console.log('Heart Rate: ' + event.target.value[1]);
		});
	});
