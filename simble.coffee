'use strict'

noble = require('noble')
EventEmitter = require('events')

# Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = (value) ->
	((value isnt undefined) and (value isnt null))

first_valid_value = (values...) ->
	for value in values
		if is_valid_value(value)
			return value
	return

buffer_to_byte_array = (buffer) ->
	[buffer...]

canonicalize_hex_string = (hex_string) ->
	hex_string.replace(/[^0-9A-Fa-f]/g, '').toLowerCase()

canonicalize_uuid = (uuid) ->
	hex = canonicalize_hex_string(uuid)
	"#{hex[0...8]}-#{hex[8...12]}-#{hex[12...16]}-#{hex[16...20]}-#{hex[20...32]}"

canonicalize_bluetooth_uuid = (uuid) ->
	if (typeof(uuid) is 'number')
		uuid = uuid.toString(0x10)
	uuid = canonicalize_hex_string(uuid)
	if (uuid.length < 8)
		uuid = ('00000000' + uuid).slice(-8)
	if (uuid.length is 8)
		uuid += '1000800000805f9b34fb'
	canonicalize_uuid(uuid)

split_into_chunks = (array, chunk_size) ->
	(array.slice(index, (index + chunk_size)) for index in [0...array.length] by chunk_size)

canonicalize_mac_address = (mac_address) ->
	split_into_chunks(canonicalize_hex_string(mac_address), 2).join(':')

class Characteristic extends EventEmitter
	constructor: (@noble_characteristic, @service) ->
		super()
		@uuid = canonicalize_bluetooth_uuid(@noble_characteristic.uuid)
		@noble_characteristic.on 'data', (data, is_notification) =>
			@emit('data', data, is_notification)
			return
		return
	read: ->
		new Promise (resolve, reject) =>
			@noble_characteristic.read (error, data) =>
				if error
					reject(error)
				else
					resolve(buffer_to_byte_array(data))
				return
			return
	write: (data, without_response) ->
		if not Buffer.isBuffer(data)
			data = Buffer.from(data)
		new Promise (resolve, reject) =>
			@noble_characteristic.write data, first_valid_value(without_response, false), (error) =>
				if error
					reject(error)
				else
					resolve(@)
				return
			return
	subscribe: (listener) ->
		new Promise (resolve, reject) =>
			@noble_characteristic.subscribe (error) =>
				if error
					reject(error)
				else
					@addListener 'data', (data) ->
						listener(buffer_to_byte_array(data))
					resolve(@)
				return
			return

class Service extends EventEmitter
	constructor: (@noble_service, @peripheral) ->
		super()
		@uuid = canonicalize_bluetooth_uuid(@noble_service.uuid)
		@update_characteristics()
		return
	update_characteristics: ->
		@characteristics = {}
		if @noble_service.characteristics
			for noble_characteristic in @noble_service.characteristics
				@characteristics[canonicalize_bluetooth_uuid(noble_characteristic.uuid)] = new Characteristic(noble_characteristic, @)
		return
	ensure_discovered: ->
		new Promise (resolve, reject) =>
			@peripheral.ensure_discovered()
			.then =>
				resolve(@)
				return
	get_discovered_characteristic: (characteristic_id) ->
		@characteristics[canonicalize_bluetooth_uuid(characteristic_id)]
	get_characteristic: (characteristic_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_characteristic(characteristic_id)

class Peripheral extends EventEmitter
	constructor: (@noble_peripheral) ->
		super()
		@address = canonicalize_mac_address(@noble_peripheral.address)
		@address_type = @noble_peripheral.addressType
		@update_services()
		@connectable = @noble_peripheral.connectable
		@rssi = @noble_peripheral.rssi
		@advertisement =
			name: @noble_peripheral.advertisement.localName
			service_uuids: @noble_peripheral.advertisement.serviceUuids.map(canonicalize_bluetooth_uuid)
			manufacturer_data: @noble_peripheral.advertisement.manufacturerData
		@is_discovered = false
		@is_connected = false
		@noble_peripheral.on 'connect', =>
			@is_connected = true
			@emit 'connected'
			return
		@noble_peripheral.on 'disconnect', =>
			@is_connected = false
			@is_discovered = false
			@emit 'disconnected'
			return
		@noble_peripheral.on 'rssiUpdate', (rssi) =>
			@rssi = rssi
			@emit 'rssi_update', rssi
			return
		return
	update_services: ->
		@services = {}
		if @noble_peripheral.services
			for noble_service in @noble_peripheral.services
				@services[canonicalize_bluetooth_uuid(noble_service.uuid)] = new Service(noble_service, @)
		return
	disconnect: ->
		new Promise (resolve, reject) =>
			@noble_peripheral.disconnect (error) =>
				if error
					reject(error)
				else
					resolve(@)
				return
			return
	ensure_connected: ->
		new Promise (resolve, reject) =>
			if @is_connected
				resolve(@)
			else
				@noble_peripheral.connect (error) =>
					if error
						reject(error)
					else
						resolve(@)
					return
			return
	connect: ->
		@ensure_connected()
	ensure_discovered: ->
		new Promise (resolve, reject) =>
			if @is_discovered
				resolve(@)
			else
				@noble_peripheral.discoverAllServicesAndCharacteristics (error) =>
					if error
						reject(error)
					else
						@update_services()
						@is_discovered = true
						@emit 'discovered'
						resolve(@)
					return
			return
	discover: ->
		@ensure_discovered()
	ensure_connected_and_discovered: ->
		@ensure_connected()
		.then =>
			@ensure_discovered()
	get_discovered_service: (service_id) ->
		@services[canonicalize_bluetooth_uuid(service_id)]
	get_service: (service_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_service(service_id)
	get_characteristic: (service_id, characteristic_id) ->
		@get_service(service_id)
		.then (service) ->
			service.get_characteristic(characteristic_id)

address_filter = (address) ->
	address = canonicalize_mac_address(address)
	(peripheral) ->
		(peripheral.address is address)

name_filter = (name) ->
	(peripheral) ->
		(peripheral.advertisement.name is name)

advertised_service_filter = (service_id) ->
	service_uuid = canonicalize_bluetooth_uuid(service_id)
	(peripheral) ->
		(service_uuid in peripheral.advertisement.service_uuids)

advertised_services_filter = (service_ids) ->
	service_uuids = service_ids.map(canonicalize_bluetooth_uuid)
	(peripheral) ->
		for servcice_uuid in service_uuids
			if (not (service_uuid in peripheral.advertisement.service_uuids))
				return false
		true

create_sub_filter = (key, value) ->
	if (value is null)
		-> true
	else
		{
			address: mac_address_filter
			name: name_filter
			service: advertised_service_filter
			services: advertised_services_filter
		}[key](value)

create_filter = (options) ->
	sub_filters = (create_sub_filter(key, value) for key, value of options)
	(peripheral) ->
		for sub_filter in sub_filters
			if (not sub_filter(peripheral))
				return false
		true

ensure_noble_state = (noble_state_string) ->
	new Promise (resolve, reject) ->
		if (noble.state is noble_state_string)
			resolve()
		else
			noble.on 'stateChange', (state) ->
				if (state is noble_state_string)
					resolve()
		return

scan_for_peripheral = (peripheral_filter) ->
	if (typeof(peripheral_filter) isnt 'function')
		peripheral_filter = create_filter(peripheral_filter)
	ensure_noble_state('poweredOn')
	.then ->
		new Promise (resolve, reject) ->
			noble.on 'discover', (noble_peripheral) ->
				peripheral = new Peripheral(noble_peripheral)
				if peripheral_filter(peripheral)
					resolve(peripheral)
					noble.stopScanning()
				return
			noble.startScanning()
			return

time_limit_promise = (promise, time_limit) ->
	new Promise (resolve, reject) ->
		Promise.resolve(promise)
		.then (promise_result) ->
			resolve(promise_result)
		.catch (promise_error) ->
			reject(promise_error)
		setTimeout ->
				reject('Promise did not resolve within time')
			, time_limit
		return

stop_scanning = ->
	new Promise (resolve, reject) ->
		noble.once 'scanStop', ->
			resolve()
			return
		noble.stopScanning()
		return

module.exports =
	canonicalize:
		bluetooth_uuid: canonicalize_bluetooth_uuid
		address: canonicalize_mac_address
	filter:
		address: address_filter
		name: name_filter
		service: advertised_service_filter
		services: advertised_services_filter
	scan_for_peripheral: scan_for_peripheral
	stop_scanning: stop_scanning
