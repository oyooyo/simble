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

# Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = (value) ->
	(not ((value is undefined) or (value is null)))

# Returns a filter function according to <options>. <options> must either be a function, in which case the function is simply returned, or an object like {"name":"btleperipheral", "services":[0x1827]}, with valid peripheral filter type ids as keys, and the parameter for that peripheral filter type as values. If one of the values is null or undefined, this sub filter will be skipped.
create_filter_function = (options) ->
	if is_function_type(options) then return options
	sub_filters = []
	for filter_type, filter_value of options
		if is_valid_value(filter_value)
			sub_filters.push(filter_types[filter_type](filter_value))
	(peripheral) ->
		for sub_filter in sub_filters
			if (not sub_filter(peripheral))
				return false
		true

# Debug log function for info
debug_info = require('debug')('simble:info')

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

# Convert a Buffer instance <buffer> to an array of byte integers
buffer_to_byte_array = (buffer) ->
	if (not is_valid_value(buffer)) then return null 
	[buffer...]

# Debug log function for events
debug_event = require('debug')('simble:event')

# Import/Require the "events" module as EventEmitter
EventEmitter = require('events')

# Returns the first value in <values...> that is neither null nor undefined
first_valid_value = (values...) ->
	for value in values
		if is_valid_value(value)
			return value
	return

# Returns the current timestamp, as milliseconds since the epoch
get_timestamp_millis = ->
	Date.now()

# The possible states a peripheral can have
peripheral_states =
	DISCONNECTED: 1
	CONNECTED: 2
	DISCOVERED: 3

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

	# Constructor, instantiates a new Characteristic instance
	constructor: (noble_characteristic, @service) ->
		super()
		@peripheral = @service.peripheral
		@set_noble_characteristic(noble_characteristic)
		return

	# Set the noble peripheral that this Characteristic instance is a wrapper for
	set_noble_characteristic: (noble_characteristic) ->
		if (noble_characteristic isnt @noble_characteristic)
			@noble_characteristic = noble_characteristic
			@uuid = canonicalize_bluetooth_uuid(@noble_characteristic.uuid)
			@properties = noble_characteristic.properties
			@noble_characteristic.on 'data', (data) =>
				data = buffer_to_byte_array(data)
				@peripheral.update_last_action_time()
				debug_data "Characteristic #{@uuid} : Receive \"#{byte_array_to_hex_string(data, ' ')}\""
				@emit('data_received', data)
				return
		@

	# Emit the event <event_id>, with optional additional arguments
	emit: (event_id) ->
		debug_event "Characteristic #{@uuid} : Event \"#{event_id}\""
		super arguments...

	# Ensure that the peripheral was discovered - returns a Promise that resolves once it is discovered
	ensure_discovered: ->
		@service.ensure_discovered()
		.then =>
			@

	# Alias for ensure_discovered()
	discover: ->
		@ensure_discovered()

	# Read the characteristic's current value. Returns a Promise that resolves to a byte array
	read: ->
		@ensure_discovered()
		.then =>
			new Promise (resolve, reject) =>
				@noble_characteristic.read (error, data) =>
					if error
						reject(error)
					else
						resolve(buffer_to_byte_array(data))
					return
				return

	# Set the characteristic's value to <data> (a byte array). If <without_response> is true, the characteristic will be written withour waiting for a response/confirmation. Returns a Promise that resolves if the characteristic was set/written
	write: (data, without_response) ->
		@ensure_discovered()
		.then =>
			data = convert_to_buffer(data)
			without_response = first_valid_value(without_response, false)
			@peripheral.update_last_action_time()
			debug_data "Characteristic #{@uuid} : Send \"#{byte_array_to_hex_string(data, ' ')}\""
			new Promise (resolve, reject) =>
				@noble_characteristic.write data, without_response, (error) =>
					if error
						reject(error)
					else
						resolve(@)
					return
				return

	# Subscribe to the characteristic. The <listener> function will be called with <data> (a byte array) argument whenever new data arrives. Returns a Promise that resolves if 
	subscribe: (listener) ->
		@ensure_discovered()
		.then =>
			new Promise (resolve, reject) =>
				@noble_characteristic.subscribe (error) =>
					if error
						reject(error)
					else
						@addListener('data_received', listener)
						resolve(@)
					return
				return

# This class represents a Bluetooth LE service
Service = class extends EventEmitter

	# Constructor, instantiates a new Service instance
	constructor: (noble_service, @peripheral) ->
		super()
		@set_noble_service(noble_service)
		return

	# Set the noble service that this Service instance is a wrapper for
	set_noble_service: (noble_service) ->
		if (noble_service isnt @noble_service)
			@noble_service = noble_service
			@uuid = canonicalize_bluetooth_uuid(@noble_service.uuid)
		@update_characteristics()
		@

	# Emit the event <event_id>, with optional additional arguments
	emit: (event_id) ->
		debug_event "Service #{@uuid} : Event \"#{event_id}\""
		super arguments...

	# Update the list of Characteristics, reusing old Characteristic instances if possible
	update_characteristics: ->
		@old_characteristics = first_valid_value(@characteristics, {})
		@characteristics = {}
		if @noble_service.characteristics
			for noble_characteristic in @noble_service.characteristics
				characteristic_uuid = canonicalize_bluetooth_uuid(noble_characteristic.uuid)
				characteristic = @old_characteristics[characteristic_uuid]
				if is_valid_value(characteristic)
					characteristic.set_noble_characteristic(noble_characteristic)
				else
					characteristic = (new Characteristic(noble_characteristic, @))
				@characteristics[characteristic_uuid] = characteristic
		@

	# Ensure that the service was discovered - returns a Promise that resolves once it is discovered
	ensure_discovered: ->
		@peripheral.ensure_discovered()
		.then =>
			@

	# Alias for ensure_discovered()
	discover: ->
		@ensure_discovered()

	# Synchronous version of get_characteristic() - requires that the peripheral was already discovered
	get_discovered_characteristic: (characteristic_id) ->
		@characteristics[canonicalize_bluetooth_uuid(characteristic_id)]

	# Asynchronous version of get_characteristic() - returns a Promise to the characteristic
	get_characteristic: (characteristic_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_characteristic(characteristic_id)

# This class represents a Bluetooth LE peripheral
Peripheral = class extends EventEmitter

	# The possible states a peripheral can have
	@STATES: peripheral_states

	# Constructor, instantiates a new Peripheral instance
	constructor: (noble_peripheral) ->
		super()
		@set_auto_disconnect_time(0)
		@set_noble_peripheral(noble_peripheral)
		return

	# Update the "last_action_time"
	update_last_action_time: ->
		@last_action_time = get_timestamp_millis()

	# Set the auto-disconnect time to <auto_disconnect_millis> milliseconds. A value of 0 disables auto-disconnect
	set_auto_disconnect_time: (@auto_disconnect_millis) ->
		@

	# Set the noble service that this Service instance is a wrapper for
	set_noble_peripheral: (noble_peripheral) ->
		if (noble_peripheral isnt @noble_peripheral)
			@noble_peripheral = noble_peripheral
			@address = canonicalize_mac_address(@noble_peripheral.address)
			@address_type = @noble_peripheral.addressType
			advertisement = @noble_peripheral.advertisement
			@advertisement =
				manufacturer_data: buffer_to_byte_array(advertisement.manufacturerData)
				name: advertisement.localName
				service_data: advertisement.serviceData.map (service_data) ->
					uuid: canonicalize_bluetooth_uuid(service_data.uuid)
					data: buffer_to_byte_array(service_data.data)
				service_solicitation_uuids: (if advertisement.serviceSolicitationUuid then advertisement.serviceSolicitationUuid.map(canonicalize_bluetooth_uuid) else [])
				service_uuids: advertisement.serviceUuids.map(canonicalize_bluetooth_uuid)
				tx_power_level: advertisement.txPowerLevel
			@connectable = @noble_peripheral.connectable
			@rssi = @noble_peripheral.rssi
			@noble_peripheral.on 'connect', =>
				@timer = setInterval =>
						if ((@auto_disconnect_millis > 0) and (get_timestamp_millis() >= (@last_action_time + @auto_disconnect_millis)))
							@ensure_disconnected()
					, 100
				@set_state(peripheral_states.CONNECTED)
				@emit 'connected'
				return
			@noble_peripheral.on 'disconnect', =>
				clearInterval(@timer)
				@timer = null
				@set_state(peripheral_states.DISCONNECTED)
				@emit 'disconnected'
				return
			@noble_peripheral.on 'rssiUpdate', (rssi) =>
				@rssi = rssi
				@emit 'rssi_update', rssi
				return
		# TODO better set state to actual state
		@set_state(peripheral_states.DISCONNECTED)
		@update_services()
		@

	# Emit the event <event_id>, with optional additional arguments
	emit: (event_id) ->
		debug_event "Peripheral #{@address} : Event \"#{event_id}\""
		super arguments...

	# Set the current state to <state> (must be one of the values in Peripheral.states
	set_state: (state) ->
		if (state isnt @state)
			@update_last_action_time()
			@state = state
			@is_connected = (state >= peripheral_states.CONNECTED)
			@is_discovered = (state >= peripheral_states.DISCOVERED)
		@

	# Update the RSSI (Received Signal Strength Indicator). Returns a Promise that resolves to the current RSSI value
	update_rssi: ->
		new Promise (resolve, reject) =>
			@noble_peripheral.updateRssi (error, rssi) ->
				if error
					reject(error)
				else
					resolve(rssi)
				return
			return

	# Update the list of services, reusing old Service instances if possible
	update_services: ->
		@old_services = first_valid_value(@services, {})
		@services = {}
		if @noble_peripheral.services
			for noble_service in @noble_peripheral.services
				service_uuid = canonicalize_bluetooth_uuid(noble_service.uuid)
				service = @old_services[service_uuid]
				if is_valid_value(service)
					service.set_noble_service(noble_service)
				else
					service = (new Service(noble_service, @))
				@services[service_uuid] = service
		@

	# Ensure the peripheral is disconnected. Returns a Promise that resolves once the peripheral is disconnected
	ensure_disconnected: ->
		new Promise (resolve, reject) =>
			if not @is_connected
				resolve(@)
			else
				@noble_peripheral.disconnect (error) =>
					if error
						reject(error)
					else
						resolve(@)
					return
			return

	# Alias for ensure_disconnected()
	disconnect: ->
		@ensure_disconnected()

	# Ensure the peripheral is connected. Returns a Promise that resolves once the peripheral is connected
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

	# Alias for ensure_connected()
	connect: ->
		@ensure_connected()

	# Ensure the peripheral is discovered. Returns a Promise that resolves once the peripheral is discovered
	ensure_discovered: ->
		@ensure_connected()
		.then =>
			new Promise (resolve, reject) =>
				if @is_discovered
					resolve(@)
				else
					@noble_peripheral.discoverAllServicesAndCharacteristics (error) =>
						if error
							reject(error)
						else
							@update_services()
							@set_state(peripheral_states.DISCOVERED)
							@emit 'discovered'
							debug_info "Peripheral #{@address} discovered:"
							for service in @services
								debug_info "  Service #{service.uuid}"
								for characteristic in service.characteristics
									debug_info "    Characteristic #{characteristic.uuid} (#{characteristic.properties.join(', ')})"
							resolve(@)
						return
				return

	# Alias for ensure_discovered()
	discover: ->
		@ensure_discovered()

	# Synchronous version of get_service() - requires that the peripheral was already discovered
	get_discovered_service: (service_id) ->
		@services[canonicalize_bluetooth_uuid(service_id)]

	# Asynchronous version of get_service() - returns a Promise to the service
	get_service: (service_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_service(service_id)

	# Synchronous version of get_characteristic() - requires that the peripheral was already discovered
	get_discovered_characteristic: (service_id, characteristic_id) ->
		@get_discovered_service(service_id).get_discovered_characteristic(characteristic_id)#

	# Asynchronous version of get_characteristic() - returns a Promise to the characteristic
	get_characteristic: (service_id, characteristic_id) ->
		@ensure_discovered()
		.then =>
			@get_discovered_characteristic(service_id, characteristic_id)

# Scan for a peripheral that matches the filter <peripheral_filter>. Returns a Promise that resolves to the peripheral if found
scan_for_peripheral = (peripheral_filter) ->
	peripheral_filter = create_filter_function(peripheral_filter)
	ensure_noble_state('poweredOn')
	.then ->
		new Promise (resolve, reject) ->
			noble.on 'discover', (noble_peripheral) ->
				peripheral = new Peripheral(noble_peripheral)
				debug_info "  Scanned peripheral #{peripheral.address} (Name:\"#{peripheral.advertisement.name}\", Services:[#{peripheral.advertisement.service_uuids.join(', ')}])"
				if peripheral_filter(peripheral)
					debug_info "Peripheral #{peripheral.address} matches filters, stopping scanning"
					noble.stopScanning()
					resolve(peripheral)
				return
			debug_info "Starting to scan for peripheral..."
			noble.startScanning()
			return

# Scan for a peripheral that matches the filter <peripheral_filter> and connect to it. Returns a Promise that resolves to the peripheral
connect_to_peripheral = (peripheral_filter) ->
	scan_for_peripheral(peripheral_filter)
	.then (peripheral) ->
		peripheral.ensure_connected()

# Scan for a peripheral that matches the filter <peripheral_filter>, connect and discover it. Returns a Promise that resolves to the peripheral
discover_peripheral = (peripheral_filter) ->
	scan_for_peripheral(peripheral_filter)
	.then (peripheral) ->
		peripheral.ensure_discovered()

# Stop scanning for peripherals. Returns a Promise that resolves if the scanning has stopped.
stop_scanning = ->
	new Promise (resolve, reject) ->
		noble.once 'scanStop', ->
			resolve()
			return
		noble.stopScanning()
		return

# Returns a promise that is a time-limited wrapper for promise <promise>. If the promise <promise> does not resolve within <time_limit> microseconds, the promise is rejected
time_limit_promise = (promise, time_limit, timeout_error_message) ->
	if (time_limit is 0) then return promise
	timeout_error_message = first_valid_value(timeout_error_message, 'Promise did not resolve within time')
	new Promise (resolve, reject) ->
		timeout = setTimeout ->
				reject(timeout_error_message)
				return
			, time_limit
		Promise.resolve(promise)
		.then (promise_result) ->
			clearTimeout(timeout)
			resolve(promise_result)
			return
		.catch (promise_error) ->
			clearTimeout(timeout)
			reject(promise_error)
			return
		return

# What this module exports
module.exports =
	canonicalize:
		address: canonicalize_mac_address
		bluetooth_uuid: canonicalize_bluetooth_uuid
	connect_to_peripheral: connect_to_peripheral
	discover_peripheral: discover_peripheral
	filter: filter_types
	scan_for_peripheral: scan_for_peripheral
	stop_scanning: stop_scanning
	utils:
		time_limit_promise: time_limit_promise
