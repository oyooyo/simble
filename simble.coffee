'use strict'

# Canonicalize hexadecimal string <hex_string> by removing all non-hexadecimal characters, and converting all hex digits to lower case
canonicalize_hex_string = (hex_string) ->
	hex_string.replace(/[^0-9A-Fa-f]/g, '').toLowerCase()

# Canonicalize UUID string <uuid>
canonicalize_uuid = (uuid) ->
	hex = canonicalize_hex_string(uuid)
	"#{hex[0...8]}-#{hex[8...12]}-#{hex[12...16]}-#{hex[16...20]}-#{hex[20...32]}"

# Canonicalize bluetooth UUID <uuid> (which may be an integer or a hexadecimal string), by converting it to a canonical, 36 characters long UUID string
canonicalize_bluetooth_uuid = (uuid) ->
	if (typeof(uuid) is 'number')
		uuid = uuid.toString(0x10)
	uuid = canonicalize_hex_string(uuid)
	if (uuid.length < 8)
		uuid = ('00000000' + uuid).slice(-8)
	if (uuid.length is 8)
		uuid += '1000800000805f9b34fb'
	canonicalize_uuid(uuid)

# Returns an array with chunks/slices of <slicable>. Each chunk/slice has the same length <chunk_length> (except for the last chunk/slice, which may have a smaller length)
split_into_chunks = (slicable, chunk_length) ->
	(slicable.slice(index, (index + chunk_length)) for index in [0...slicable.length] by chunk_length)

# Canonicalize the MAC address <mac_address> (a string)
canonicalize_mac_address = (mac_address) ->
	split_into_chunks(canonicalize_hex_string(mac_address), 2).join(':')

# Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <address>
address_filter = (address) ->
	address = canonicalize_mac_address(address)
	(peripheral) ->
		(peripheral.address is address)

# Returns true if <value> is an array
is_array = (value) ->
	Array.isArray(value)

# Returns a peripheral filter function with argument <peripheral> that returns true if all service IDs in <service_ids> are in the list of services that peripheral <peripheral> advertises
advertised_services_filter = (service_ids) ->
	if not is_array(service_ids)
		service_ids = [service_ids]
	service_uuids = service_ids.map(canonicalize_bluetooth_uuid)
	(peripheral) ->
		for service_uuid in service_uuids
			if (not (service_uuid in peripheral.advertisement.service_uuids))
				return false
		true

# Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <name>
name_filter = (name) ->
	(peripheral) ->
		(peripheral.advertisement.name is name)

# The various filter types
filter_types =
	address: address_filter
	name: name_filter
	service: advertised_services_filter
	services: advertised_services_filter

# Returns a function with argument <value> that returns true if <value> is of type <type_string>, false otherwise
is_of_type = (type_string) ->
	(value) ->
		(typeof(value) is type_string)

# Returns true if the passed argument <value> is of type "function", false otherwise
is_function_type = is_of_type('function')

# Returns a filter function according to <options>. <options> must either be a function, in which case the function is simply returned, or an object like {"name":"btleperipheral", "services":[0x1827]}, with valid peripheral filter type ids as keys, and the parameter for that peripheral filter type as values.
create_filter_function = (options) ->
	if is_function_type(options) then return options
	sub_filters = (filter_types[filter_type](filter_value) for filter_type, filter_value of options)
	(peripheral) ->
		for sub_filter in sub_filters
			if (not sub_filter(peripheral))
				return false
		true

# Import/Require the "noble" module for Bluetooth LE communication
noble = require('noble')

# Returns a promise that resolves is the state is noble is <noble_state_string>
ensure_noble_state = (noble_state_string) ->
	new Promise (resolve, reject) ->
		if (noble.state is noble_state_string)
			resolve()
		else
			noble.on 'stateChange', (state) ->
				if (state is noble_state_string)
					resolve()
				return
		return

# Debug log function for events
debug_event = require('debug')('simble:event')

# Import/Require the "events" module as EventEmitter
EventEmitter = require('events')

# The possible states a peripheral can have
peripheral_states =
	disconnected: 1
	connected: 2
	discovered: 3

# Convert a Buffer instance <buffer> to an array of byte integers
buffer_to_byte_array = (buffer) ->
	[buffer...]

# Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = (value) ->
	((value isnt undefined) and (value isnt null))

# Returns the first value in <values...> that is neither null nor undefined
first_valid_value = (values...) ->
	for value in values
		if is_valid_value(value)
			return value
	return

# Converts integer value <integer> into a zero-prefixed hexadecimal string of length <number_of_digits>
integer_to_zero_prefixed_hex_string = (integer, number_of_digits) ->
	('0'.repeat(number_of_digits) + integer.toString(0x10)).slice(-number_of_digits)

# Convert the byte array <byte_array> to a hexadecimal string. Every byte value is converted to a two-digit, zero padded hexadecimal string, prefixed with string <prefix_string> (default:""), suffixed with string <suffix_string> (default:""). All bytes are separated with string <separator_string> (default:" ")
byte_array_to_hex_string = (byte_array, separator_string, prefix_string, suffix_string) ->
	separator_string = first_valid_value(separator_string, ' ')
	prefix_string = first_valid_value(prefix_string, '')
	suffix_string = first_valid_value(suffix_string, '')
	("#{prefix_string}#{integer_to_zero_prefixed_hex_string(byte, 2)}#{suffix_string}" for byte in byte_array).join(separator_string)

# Convert <value> to a Buffer instance
convert_to_buffer = (value) ->
	if not Buffer.isBuffer(value)
		value = Buffer.from(value)
	value

# Debug log function for data that is being transferred
debug_data = require('debug')('simble:data')

# This class represents a Bluetooth LE characteristic
Characteristic = class extends EventEmitter
	constructor: (@noble_characteristic, @service) ->
		super()
		@uuid = canonicalize_bluetooth_uuid(@noble_characteristic.uuid)
		@noble_characteristic.on 'data', (data) =>
			data = buffer_to_byte_array(data)
			debug_data "Characteristic #{@uuid} : Receive \"#{byte_array_to_hex_string(data, ' ')}\""
			@emit('data_received', data)
			return
		return
	emit: (event_id) ->
		debug_event "Characteristic #{@uuid} : Event \"#{event_id}\""
		super arguments...
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
		data = convert_to_buffer(data)
		without_response = first_valid_value(without_response, false)
		debug_data "Characteristic #{@uuid} : Send \"#{byte_array_to_hex_string(data, ' ')}\""
		new Promise (resolve, reject) =>
			@noble_characteristic.write data, without_response, (error) =>
				if error
					reject(error)
				else
					resolve()
				return
			return
	subscribe: (listener) ->
		new Promise (resolve, reject) =>
			@noble_characteristic.subscribe (error) =>
				if error
					reject(error)
				else
					@addListener('data_received', listener)
					resolve()
				return
			return

# This class represents a Bluetooth LE service
Service = class extends EventEmitter
	constructor: (@noble_service, @peripheral) ->
		super()
		@uuid = canonicalize_bluetooth_uuid(@noble_service.uuid)
		@update_characteristics()
		return
	emit: (event_id) ->
		debug_event "Service #{@uuid} : Event \"#{event_id}\""
		super arguments...
	update_characteristics: ->
		@characteristics = {}
		if @noble_service.characteristics
			for noble_characteristic in @noble_service.characteristics
				@characteristics[canonicalize_bluetooth_uuid(noble_characteristic.uuid)] = new Characteristic(noble_characteristic, @)
		return
	ensure_discovered: ->
		@peripheral.ensure_discovered()
	get_discovered_characteristic: (characteristic_id) ->
		@characteristics[canonicalize_bluetooth_uuid(characteristic_id)]
	get_characteristic: (characteristic_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_characteristic(characteristic_id)

# This class represents a Bluetooth LE peripheral
Peripheral = class extends EventEmitter
	@states: peripheral_states
	constructor: (@noble_peripheral) ->
		super()
		@address = canonicalize_mac_address(@noble_peripheral.address)
		@address_type = @noble_peripheral.addressType
		@advertisement =
			name: @noble_peripheral.advertisement.localName
			service_uuids: @noble_peripheral.advertisement.serviceUuids.map(canonicalize_bluetooth_uuid)
			manufacturer_data: @noble_peripheral.advertisement.manufacturerData
		@connectable = @noble_peripheral.connectable
		@rssi = @noble_peripheral.rssi
		# TODO is this safe? could noble_peripheral already be connected?
		@set_state(peripheral_states.disconnected)
		@update_services()
		@noble_peripheral.on 'connect', =>
			@set_state(peripheral_states.connected)
			@emit 'connected'
			return
		@noble_peripheral.on 'disconnect', =>
			@set_state(peripheral_states.disconnected)
			@emit 'disconnected'
			return
		@noble_peripheral.on 'rssiUpdate', (rssi) =>
			@rssi = rssi
			@emit 'rssi_update', rssi
			return
		return
	emit: (event_id) ->
		debug_event "Peripheral #{@address} : Event \"#{event_id}\""
		super arguments...
	set_state: (state) ->
		if (state isnt @state)
			@state = state
			@is_connected = (state >= peripheral_states.connected)
			@is_discovered = (state >= peripheral_states.discovered)
		return
	update_services: ->
		@services = {}
		if @noble_peripheral.services
			for noble_service in @noble_peripheral.services
				@services[canonicalize_bluetooth_uuid(noble_service.uuid)] = new Service(noble_service, @)
		return
	ensure_disconnected: ->
		new Promise (resolve, reject) =>
			if not @is_connected
				resolve()
			else
				@noble_peripheral.disconnect (error) =>
					if error
						reject(error)
					else
						resolve()
					return
			return
	# Alias for ensure_disconnected()
	disconnect: ->
		@ensure_disconnected()
	ensure_connected: ->
		new Promise (resolve, reject) =>
			if @is_connected
				resolve()
			else
				@noble_peripheral.connect (error) =>
					if error
						reject(error)
					else
						resolve()
					return
			return
	# Alias for ensure_connected()
	connect: ->
		@ensure_connected()
	ensure_discovered: ->
		@ensure_connected()
		.then =>
			new Promise (resolve, reject) =>
				if @is_discovered
					resolve()
				else
					@noble_peripheral.discoverAllServicesAndCharacteristics (error) =>
						if error
							reject(error)
						else
							@update_services()
							@set_state(peripheral_states.discovered)
							@emit 'discovered'
							resolve()
						return
				return
	# Alias for ensure_discovered()
	discover: ->
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

# Scan for a peripheral that matches the filter <peripheral_filter>. Returns a Promise that resolves to the peripheral if found
scan_for_peripheral = (peripheral_filter) ->
	peripheral_filter = create_filter_function(peripheral_filter)
	ensure_noble_state('poweredOn')
	.then ->
		new Promise (resolve, reject) ->
			noble.on 'discover', (noble_peripheral) ->
				peripheral = new Peripheral(noble_peripheral)
				if peripheral_filter(peripheral)
					noble.stopScanning()
					resolve(peripheral)
				return
			noble.startScanning()
			return

# Stop scanning for peripherals. Returns a Promise that resolves if the scanning has stopped.
stop_scanning = ->
	new Promise (resolve, reject) ->
		noble.once 'scanStop', ->
			resolve()
			return
		noble.stopScanning()
		return

# What this module exports
module.exports =
	canonicalize:
		address: canonicalize_mac_address
		bluetooth_uuid: canonicalize_bluetooth_uuid
	filter: filter_types
	scan_for_peripheral: scan_for_peripheral
	stop_scanning: stop_scanning
