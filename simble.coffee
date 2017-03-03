noble = require('noble')
EventEmitter = require('events')

convert_id = (id) ->
	switch typeof(id)
		when 'string' then id
		when 'number' then id.toString(0x10)

class Characteristic
	constructor: (@noble_characteristic, @service) ->
		@event_emitter = new EventEmitter()
		@noble_characteristic.on 'data', (data, is_notification) =>
			event =
				target:
					value: data
			@event_emitter.emit('characteristicvaluechanged', event)
	addEventListener: (event_id, event_listener) ->
		@event_emitter.on(event_id, event_listener)
		Promise.resolve(@)
	readValue: ->
		new Promise (resolve, reject) =>
			@noble_characteristic.read (error, data) =>
				if error
					reject(error)
				else
					resolve(data)
	writeValue: (data) ->
		new Promise (resolve, reject) =>
			@noble_characteristic.writeValue data, (error) =>
				if error
					reject(error)
				else
					resolve(@)
	startNotifications: ->
		new Promise (resolve, reject) =>
			@noble_characteristic.notify true, (error) =>
				if error
					reject(error)
				else
					resolve(@)
	subscribe: (listener) ->
		@startNotifications()
		.then @addEventListener('characteristicvaluechanged', listener)

class Service
	constructor: (@noble_service) ->
	getCharacteristic: (characteristic_id) ->
		new Promise (resolve, reject) =>
			@noble_service.discoverCharacteristics [convert_id(characteristic_id)], (error, noble_characteristics) =>
				if error
					reject(error)
				else
					resolve(new Characteristic(noble_characteristics[0], @))

class Server
	constructor: (@noble_peripheral) ->
	connect: ->
		new Promise (resolve, reject) =>
			@noble_peripheral.connect (error) =>
				if error
					reject(error)
				else
					resolve(@)
	disconnect: ->
		new Promise (resolve, reject) =>
			@noble_peripheral.disconnect (error) =>
				if error
					reject(error)
				else
					resolve(@)
	getPrimaryService: (service_id) ->
		new Promise (resolve, reject) =>
			@noble_peripheral.discoverServices [convert_id(service_id)], (error, noble_services) =>
				if error
					reject(error)
				else
					resolve(new Service(noble_services[0]))

class Device
	constructor: (@noble_peripheral) ->
		@name = @noble_peripheral.advertisement.localName
		@gatt = new Server(@noble_peripheral)
		@event_emitter = new EventEmitter()
		@noble_peripheral.once 'disconnect', =>
			event =
				target: @
			@event_emitter.emit('gattserverdisconnected', event)
	addEventListener: (event_id, event_listener) ->
		@event_emitter.on(event_id, event_listener)
		Promise.resolve(@)

request_device = (options) ->
	new Promise (resolve, reject) ->
		noble.on 'stateChange', (state) ->
			if state is 'poweredOn'
				noble.on 'discover', (peripheral) ->
					resolve(new Device(peripheral))
				noble.startScanning(options.filters.services)
			else
				noble.stopScanning()

request_server = (options) ->
	request_device(options)
	.then (device) ->
		device.gatt.connect()

request_service = (service_id, options) ->
	request_server(options or {filters: [{services: [service_id]}]})
	.then (server) ->
		server.getPrimaryService(service_id)

request_characteristic = (characteristic_id, service_id, options) ->
	request_service(service_id, options)
	.then (service) ->
		service.getCharacteristic(characteristic_id)

module.exports =
	requestDevice: request_device
	requestServer: request_server
	requestService: request_service
	requestCharacteristic: request_characteristic
