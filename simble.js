'use strict';

// Canonicalize hexadecimal string <hex_string> by removing all non-hexadecimal characters, and converting all hex digits to lower case
const canonicalize_hex_string = function(hex_string) {
	return hex_string.replace(/[^0-9A-Fa-f]/g, '').toLowerCase();
};

// Canonicalize UUID string <uuid>
const canonicalize_uuid = function(uuid) {
	const hex = canonicalize_hex_string(uuid);
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

// Canonicalize bluetooth UUID <uuid> (which may be an integer or a hexadecimal string), by converting it to a canonical, 36 characters long UUID string
const canonicalize_bluetooth_uuid = function(uuid) {
	if (typeof uuid === 'number') {
		uuid = uuid.toString(0x10);
	}
	uuid = canonicalize_hex_string(uuid);
	if (uuid.length < 8) {
		uuid = ('00000000' + uuid).slice(-8);
	}
	if (uuid.length === 8) {
		uuid += '1000800000805f9b34fb';
	}
	return canonicalize_uuid(uuid);
};

// Returns an array with chunks/slices of <slicable>. Each chunk/slice has the same length <chunk_length> (except for the last chunk/slice, which may have a smaller length)
const split_into_chunks = function(slicable, chunk_length) {
	const results = [];
	for (let index = 0; index < slicable.length; index += chunk_length) {
		results.push(slicable.slice(index, (index + chunk_length)));
	}
	return results;
};

// Canonicalize the MAC address <mac_address> (a string)
const canonicalize_mac_address = function(mac_address) {
	return split_into_chunks(canonicalize_hex_string(mac_address), 2).join(':');
};

// Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <address>
const address_filter = function(address) {
	address = canonicalize_mac_address(address);
	return function(peripheral) {
		return (peripheral.address === address);
	};
};

// Returns a peripheral filter function with argument <peripheral> that returns true if all service IDs in <service_ids> are in the list of services that peripheral <peripheral> advertises
const advertised_services_filter = function(service_ids) {
	if (! Array.isArray(service_ids)) {
		service_ids = [service_ids];
	}
	const service_uuids = service_ids.map(canonicalize_bluetooth_uuid);
	return function(peripheral) {
		for (let service_uuid of service_uuids) {
			if (! peripheral.advertisement.service_uuids.includes(service_uuid)) {
				return false;
			}
		}
		return true;
	};
};

// Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <name>
const name_filter = function(name) {
	return function(peripheral) {
		return (peripheral.advertisement.name === name);
	};
};

// The various filter types
const filter_types = {
	address: address_filter,
	name: name_filter,
	service: advertised_services_filter,
	services: advertised_services_filter,
};

// Returns true if the passed argument <value> is neither null nor undefined
const is_neither_null_nor_undefined = function(value) {
	return (! ((value === null) || (value === undefined)));
};

// Returns a filter function according to <options>. <options> must either be a function, in which case the function is simply returned, or an object like {"name":"btleperipheral", "services":[0x1827]}, with valid peripheral filter type ids as keys, and the parameter for that peripheral filter type as values. If one of the values is null or undefined, this sub filter will be skipped.
const create_filter_function = function(options) {
	if (typeof options === 'function') {
		return options;
	}
	const sub_filters = [];
	for (let filter_type in options) {
		let filter_value = options[filter_type];
		if (is_neither_null_nor_undefined(filter_value)) {
			sub_filters.push(filter_types[filter_type](filter_value));
		}
	}
	return function(peripheral) {
		for (let sub_filter of sub_filters) {
			if (!sub_filter(peripheral)) {
				return false;
			}
		}
		return true;
	};
};

// Debug log function for info
const debug_info = require('debug')('simble:info');

// Import/Require the "noble" module for Bluetooth LE communication
const noble = require('@abandonware/noble');

// Register a temporary event listener <event_listener> for event <event_name> on event emitter <event_emitter>.
// If the event emitter returns the boolean value true, the event listener will be removed
const register_temporary_event_listener = function(event_emitter, event_name, event_listener) {
	const event_listener_proxy = function(...event_args) {
		const event_listener_return_value = event_listener(...event_args);
		if (event_listener_return_value === true) {
			event_emitter.removeListener(event_name, event_listener_proxy);
		}
	};
	event_emitter.on(event_name, event_listener_proxy);
};

// Returns a promise that resolves is the state is noble is <noble_state_string>
const ensure_noble_state = function(noble_state_string) {
	return new Promise(function(resolve, reject) {
		if (noble.state === noble_state_string) {
			resolve();
		} else {
			register_temporary_event_listener(noble, 'stateChange', function(state) {
				if (state === noble_state_string) {
					resolve();
					return true;
				}
			});
		}
	});
};

// Convert a Buffer instance <buffer> to an array of byte integers
const buffer_to_byte_array = function(buffer) {
	if (! is_neither_null_nor_undefined(buffer)) {
		return null;
	}
	return [...buffer];
};

// Debug log function for events
const debug_event = require('debug')('simble:event');

// Import/Require the "events" module as Event_Emitter
const Event_Emitter = require('events');

// Returns <value> if <value> is neither null nor undefined, <default_value> otherwise
const value_with_default = function(value, default_value) {
	return (is_neither_null_nor_undefined(value) ? value : default_value);
};

// Returns the current timestamp, as milliseconds since the epoch
const get_timestamp_millis = function() {
	return Date.now();
};

// The possible states a peripheral can have
const peripheral_states = {
	DISCONNECTED: 1,
	CONNECTED: 2,
	DISCOVERED: 3
};

// Converts integer value <integer> into a zero-prefixed hexadecimal string of length <number_of_digits>
const integer_to_zero_prefixed_hex_string = function(integer, number_of_digits) {
	return ('0'.repeat(number_of_digits) + integer.toString(0x10)).slice(-number_of_digits);
};

// Convert the byte array <byte_array> to a hexadecimal string. Every byte value is converted to a two-digit, zero padded hexadecimal string, prefixed with string <prefix_string> (default:""), suffixed with string <suffix_string> (default:""). All bytes are separated with string <separator_string> (default:" ")
const byte_array_to_hex_string = function(byte_array, separator_string, prefix_string, suffix_string) {
	separator_string = value_with_default(separator_string, ' ');
	prefix_string = value_with_default(prefix_string, '');
	suffix_string = value_with_default(suffix_string, '');
	return byte_array.map(function(byte) {
		return `${prefix_string}${integer_to_zero_prefixed_hex_string(byte, 2)}${suffix_string}`;
	}).join(separator_string);
};

// Convert <value> to a Buffer instance
const convert_to_buffer = function(value) {
	return (Buffer.isBuffer(value) ? value : Buffer.from(value));
};

// Debug log function for data that is being transferred
const debug_data = require('debug')('simble:data');

// This class represents a Bluetooth LE characteristic
const Characteristic = class extends Event_Emitter {
	// Constructor, instantiates a new Characteristic instance
	constructor(noble_characteristic, service) {
		super();
		this.service = service;
		this.peripheral = this.service.peripheral;
		this.set_noble_characteristic(noble_characteristic);
	}

	// Set the noble peripheral that this Characteristic instance is a wrapper for
	set_noble_characteristic(noble_characteristic) {
		if (noble_characteristic !== this.noble_characteristic) {
			this.noble_characteristic = noble_characteristic;
			this.uuid = canonicalize_bluetooth_uuid(this.noble_characteristic.uuid);
			this.properties = noble_characteristic.properties;
		}
		return this;
	}

	// Emit the event <event_id>, with optional additional arguments
	emit(event_id) {
		debug_event(`Characteristic ${this.uuid} : Event "${event_id}"`);
		return super.emit(...arguments);
	}

	// Ensure that the peripheral was discovered - returns a Promise that resolves once it is discovered
	ensure_discovered() {
		return this.service.ensure_discovered().then(() => {
			return this;
		});
	}

	// Alias for ensure_discovered()
	discover() {
		return this.ensure_discovered();
	}

	// Read the characteristic's current value. Returns a Promise that resolves to a byte array
	read() {
		return this.ensure_discovered().then(() => {
			return new Promise((resolve, reject) => {
				this.noble_characteristic.read((error, data) => {
					if (error) {
						reject(error);
					} else {
						resolve(buffer_to_byte_array(data));
					}
				});
			});
		});
	}

	// Set the characteristic's value to <data> (a byte array). If <without_response> is true, the characteristic will be written withour waiting for a response/confirmation. Returns a Promise that resolves if the characteristic was set/written
	write(data, without_response) {
		return this.ensure_discovered().then(() => {
			data = convert_to_buffer(data);
			without_response = value_with_default(without_response, false);
			this.peripheral.update_last_action_time();
			debug_data(`Characteristic ${this.uuid} : Send "${byte_array_to_hex_string(data, ' ')}"`);
			return new Promise((resolve, reject) => {
				this.noble_characteristic.write(data, without_response, (error) => {
					if (error) {
						reject(error);
					} else {
						resolve(this);
					}
				});
			});
		});
	}

	// Subscribe to the characteristic. The <listener> function will be called with <data> (a byte array) argument whenever new data arrives. Returns a Promise that resolves if 
	subscribe(listener) {
		return this.ensure_discovered().then(() => {
			return new Promise((resolve, reject) => {
				this.noble_characteristic.subscribe((error) => {
					if (error) {
						reject(error);
					} else {
						this.noble_characteristic.on('data', (data) => {
							data = buffer_to_byte_array(data);
							this.peripheral.update_last_action_time();
							debug_data(`Characteristic ${this.uuid} : Receive "${byte_array_to_hex_string(data, ' ')}"`);
							this.emit('data_received', data);
						});
						this.addListener('data_received', listener);
						resolve(this);
					}
				});
			});
		});
	}

};

// This class represents a Bluetooth LE service
const Service = class extends Event_Emitter {
	// Constructor, instantiates a new Service instance
	constructor(noble_service, peripheral) {
		super();
		this.peripheral = peripheral;
		this.set_noble_service(noble_service);
	}

	// Set the noble service that this Service instance is a wrapper for
	set_noble_service(noble_service) {
		if (noble_service !== this.noble_service) {
			this.noble_service = noble_service;
			this.uuid = canonicalize_bluetooth_uuid(this.noble_service.uuid);
		}
		this.update_characteristics();
		return this;
	}

	// Emit the event <event_id>, with optional additional arguments
	emit(event_id) {
		debug_event(`Service ${this.uuid} : Event "${event_id}"`);
		return super.emit(...arguments);
	}

	// Update the list of Characteristics, reusing old Characteristic instances if possible
	update_characteristics() {
		this.old_characteristics = value_with_default(this.characteristics, {});
		this.characteristics = {};
		if (this.noble_service.characteristics) {
			for (let noble_characteristic of this.noble_service.characteristics) {
				let characteristic_uuid = canonicalize_bluetooth_uuid(noble_characteristic.uuid);
				let characteristic = this.old_characteristics[characteristic_uuid];
				if (is_neither_null_nor_undefined(characteristic)) {
					characteristic.set_noble_characteristic(noble_characteristic);
				} else {
					characteristic = new Characteristic(noble_characteristic, this);
				}
				this.characteristics[characteristic_uuid] = characteristic;
			}
		}
		return this;
	}

	// Ensure that the service was discovered - returns a Promise that resolves once it is discovered
	ensure_discovered() {
		return this.peripheral.ensure_discovered().then(() => {
			return this;
		});
	}

	// Alias for ensure_discovered()
	discover() {
		return this.ensure_discovered();
	}

	// Synchronous version of get_characteristic() - requires that the peripheral was already discovered
	get_discovered_characteristic(characteristic_id) {
		return this.characteristics[canonicalize_bluetooth_uuid(characteristic_id)];
	}

	// Asynchronous version of get_characteristic() - returns a Promise to the characteristic
	get_characteristic(characteristic_id) {
		return this.ensure_discovered().then(() => {
			return this.get_discovered_characteristic(characteristic_id);
		});
	}

};

// This class represents a Bluetooth LE peripheral
const Peripheral = class extends Event_Emitter {
	// Constructor, instantiates a new Peripheral instance
	constructor(noble_peripheral) {
		super();
		this.set_auto_disconnect_time(0);
		this.set_noble_peripheral(noble_peripheral);
	}

	// Update the "last_action_time"
	update_last_action_time() {
		return this.last_action_time = get_timestamp_millis();
	}

	// Set the auto-disconnect time to <auto_disconnect_millis> milliseconds. A value of 0 disables auto-disconnect
	set_auto_disconnect_time(auto_disconnect_millis) {
		this.auto_disconnect_millis = auto_disconnect_millis;
		return this;
	}

	// Set the noble service that this Service instance is a wrapper for
	set_noble_peripheral(noble_peripheral) {
		if (noble_peripheral !== this.noble_peripheral) {
			this.noble_peripheral = noble_peripheral;
			if (noble_peripheral !== null) {
				this.address = canonicalize_mac_address(this.noble_peripheral.address);
				this.address_type = this.noble_peripheral.addressType;
				const noble_advertisement = this.noble_peripheral.advertisement;
				this.advertisement = {
					manufacturer_data: buffer_to_byte_array(noble_advertisement.manufacturerData),
					name: noble_advertisement.localName,
					service_data: noble_advertisement.serviceData.map(function(service_data) {
						return {
							uuid: canonicalize_bluetooth_uuid(service_data.uuid),
							data: buffer_to_byte_array(service_data.data),
						};
					}),
					service_solicitation_uuids: (noble_advertisement.serviceSolicitationUuid ? noble_advertisement.serviceSolicitationUuid.map(canonicalize_bluetooth_uuid) : []),
					service_uuids: noble_advertisement.serviceUuids.map(canonicalize_bluetooth_uuid),
					tx_power_level: noble_advertisement.txPowerLevel,
				};
				this.connectable = this.noble_peripheral.connectable;
				this.rssi = this.noble_peripheral.rssi;
				this.update_services();
			}
		}
		// TODO better set state to actual state
		this.set_state(peripheral_states.DISCONNECTED);
		return this;
	}

	// Emit the event <event_id>, with optional additional arguments
	emit(event_id) {
		debug_event(`Peripheral ${this.address} : Event "${event_id}"`);
		return super.emit(...arguments);
	}

	// Set the current state to <state> (must be one of the values in Peripheral.states
	set_state(state) {
		if (state !== this.state) {
			this.update_last_action_time();
			this.state = state;
			this.is_connected = (state >= peripheral_states.CONNECTED);
			this.is_discovered = (state >= peripheral_states.DISCOVERED);
		}
		return this;
	}

	// Update the RSSI (Received Signal Strength Indicator). Returns a Promise that resolves to the current RSSI value
	update_rssi() {
		return new Promise((resolve, reject) => {
			this.noble_peripheral.updateRssi(function(error, rssi) {
				if (error) {
					reject(error);
				} else {
					resolve(rssi);
				}
			});
		});
	}

	// Update the list of services, reusing old Service instances if possible
	update_services() {
		this.old_services = value_with_default(this.services, {});
		this.services = {};
		if (this.noble_peripheral.services) {
			for (let noble_service of this.noble_peripheral.services) {
				let service_uuid = canonicalize_bluetooth_uuid(noble_service.uuid);
				let service = this.old_services[service_uuid];
				if (is_neither_null_nor_undefined(service)) {
					service.set_noble_service(noble_service);
				} else {
					service = new Service(noble_service, this);
				}
				this.services[service_uuid] = service;
			}
		}
		return this;
	}

	// Ensure the peripheral is disconnected. Returns a Promise that resolves once the peripheral is disconnected
	ensure_disconnected() {
		return new Promise((resolve, reject) => {
			if (! this.is_connected) {
				resolve(this);
			} else {
				this.noble_peripheral.disconnect((error) => {
					if (error) {
						reject(error);
					} else {
						resolve(this);
					}
				});
			}
		});
	}

	// Alias for ensure_disconnected()
	disconnect() {
		return this.ensure_disconnected();
	}

	// Ensure the peripheral is connected. Returns a Promise that resolves once the peripheral is connected
	ensure_connected() {
		return new Promise((resolve, reject) => {
			if (this.is_connected) {
				resolve(this);
			} else {
				debug_info(`Connecting to peripheral ${this.address}...`);
				this.noble_peripheral.connect((error) => {
					if (error) {
						reject(error);
					} else {
						this.timer = setInterval(() => {
							if ((this.auto_disconnect_millis > 0) && (get_timestamp_millis() >= (this.last_action_time + this.auto_disconnect_millis))) {
								return this.ensure_disconnected();
							}
						}, 100);
						this.set_state(peripheral_states.CONNECTED);
						this.emit('connected');
						this.noble_peripheral.once('disconnect', () => {
							clearInterval(this.timer);
							this.timer = null;
							this.set_noble_peripheral(null);
							this.set_state(peripheral_states.DISCONNECTED);
							this.emit('disconnected');
						});
						debug_info(`Connected to peripheral ${this.address}`);
						resolve(this);
					}
				});
			}
		});
	}

	// Alias for ensure_connected()
	connect() {
		return this.ensure_connected();
	}

	// Ensure the peripheral is discovered. Returns a Promise that resolves once the peripheral is discovered
	ensure_discovered() {
		return this.ensure_connected().then(() => {
			return new Promise((resolve, reject) => {
				if (this.is_discovered) {
					resolve(this);
				} else {
					debug_info(`Discovering peripheral ${this.address}...`);
					this.noble_peripheral.discoverAllServicesAndCharacteristics((error) => {
						if (error) {
							reject(error);
						} else {
							this.update_services();
							debug_info(`Peripheral ${this.address} discovered:`);
							for (let service_uuid in this.services) {
								let service = this.services[service_uuid];
								debug_info(`  Service ${service.uuid}`);
								for (let characteristic_uuid in service.characteristics) {
									let characteristic = service.characteristics[characteristic_uuid];
									debug_info(`    Characteristic ${characteristic.uuid} (${characteristic.properties.join(', ')})`);
								}
							}
							this.set_state(peripheral_states.DISCOVERED);
							this.emit('discovered');
							resolve(this);
						}
					});
				}
			});
		});
	}

	// Alias for ensure_discovered()
	discover() {
		return this.ensure_discovered();
	}

	// Synchronous version of get_service() - requires that the peripheral was already discovered
	get_discovered_service(service_id) {
		return this.services[canonicalize_bluetooth_uuid(service_id)];
	}

	// Asynchronous version of get_service() - returns a Promise to the service
	get_service(service_id) {
		return this.ensure_discovered().then(() => {
			return this.get_discovered_service(service_id);
		});
	}

	// Synchronous version of get_characteristic() - requires that the peripheral was already discovered
	get_discovered_characteristic(service_id, characteristic_id) {
		return this.get_discovered_service(service_id).get_discovered_characteristic(characteristic_id); 
	}

	
	// Asynchronous version of get_characteristic() - returns a Promise to the characteristic
	get_characteristic(service_id, characteristic_id) {
		return this.ensure_discovered().then(() => {
			return this.get_discovered_characteristic(service_id, characteristic_id);
		});
	}

}

// The possible states a peripheral can have
Peripheral.STATES = peripheral_states;

// Scan for a peripheral that matches the filter <peripheral_filter>. Returns a Promise that resolves to the peripheral if found
const scan_for_peripheral = function(peripheral_filter) {
	peripheral_filter = create_filter_function(peripheral_filter);
	return ensure_noble_state('poweredOn').then(function() {
		return new Promise(function(resolve, reject) {
			register_temporary_event_listener(noble, 'discover', function(noble_peripheral) {
				const peripheral = new Peripheral(noble_peripheral);
				debug_info(`  Scanned peripheral ${peripheral.address} (Name:"${peripheral.advertisement.name}", advertised services:[${peripheral.advertisement.service_uuids.join(', ')}])`);
				if (peripheral_filter(peripheral)) {
					debug_info(`Peripheral ${peripheral.address} matches filters, stopping scanning`);
					noble.stopScanning();
					resolve(peripheral);
					return true;
				}
			});
			debug_info("Starting to scan for peripheral...");
			noble.startScanning();
		});
	});
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Returns a Promise that resolves to that service
const connect_to_service = function(service_id) {
	return scan_for_peripheral({
		service: service_id
	}).then(function(peripheral) {
		return peripheral.get_service(service_id);
	});
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Returns a Promise that resolves to the characteristic with ID <characteristic_id> of that service
const connect_to_characteristic = function(service_id, characteristic_id) {
	return connect_to_service(service_id).then(function(service) {
		return service.get_characteristic(characteristic_id);
	});
};

// Scan for a peripheral that matches the filter <peripheral_filter> and connect to it. Returns a Promise that resolves to the peripheral
const connect_to_peripheral = function(peripheral_filter) {
	return scan_for_peripheral(peripheral_filter).then(function(peripheral) {
		return peripheral.ensure_connected();
	});
};

// Scan for a peripheral that matches the filter <peripheral_filter>, connect and discover it. Returns a Promise that resolves to the peripheral
const discover_peripheral = function(peripheral_filter) {
	return scan_for_peripheral(peripheral_filter).then(function(peripheral) {
		return peripheral.ensure_discovered();
	});
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Publish the data <data> to the characteristic with ID <characteristic_id> of that service. If <without_response> is set to true, the data will be published without requiring a confirmation response. Returns a Promise that resolves when the data was published
const publish_to_characteristic = function(service_id, characteristic_id, data, without_response) {
	return connect_to_characteristic(service_id, characteristic_id).then(function(characteristic) {
		return characteristic.write(data, without_response);
	});
};

// Stop scanning for peripherals. Returns a Promise that resolves if the scanning has stopped.
const stop_scanning = function() {
	return new Promise(function(resolve, reject) {
		noble.once('scanStop', function() {
			//noble.removeAllListeners('discover')
			resolve();
		});
		noble.stopScanning();
	});
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Subscribe to the characteristic with ID <characteristic_id> of that service. Returns a Promise that resolves when the subscribing was successful
const subscribe_to_characteristic = function(service_id, characteristic_id, subscriber_callback) {
	return connect_to_characteristic(service_id, characteristic_id).then(function(characteristic) {
		return characteristic.subscribe(subscriber_callback);
	});
};

// Returns a promise that is a time-limited wrapper for promise <promise>. If the promise <promise> does not resolve within <time_limit> microseconds, the promise is rejected
const time_limit_promise = function(promise, time_limit, timeout_error_message) {
	if (time_limit === 0) {
		return promise;
	}
	timeout_error_message = value_with_default(timeout_error_message, 'Promise did not resolve within time');
	return new Promise(function(resolve, reject) {
		const timeout = setTimeout(function() {
			reject(timeout_error_message);
		}, time_limit);
		Promise.resolve(promise).then(function(promise_result) {
			clearTimeout(timeout);
			resolve(promise_result);
		}).catch(function(promise_error) {
			clearTimeout(timeout);
			reject(promise_error);
		});
	});
};

// What this module exports
module.exports = {
	canonicalize: {
		address: canonicalize_mac_address,
		bluetooth_uuid: canonicalize_bluetooth_uuid,
	},
	connect: {
		characteristic: connect_to_characteristic,
		peripheral: connect_to_peripheral,
		service: connect_to_service,
	},
	connect_to_characteristic: connect_to_characteristic,
	connect_to_peripheral: connect_to_peripheral,
	connect_to_service: connect_to_service,
	discover_peripheral: discover_peripheral,
	filter: filter_types,
	publish_to_characteristic: publish_to_characteristic,
	scan_for_peripheral: scan_for_peripheral,
	stop_scanning: stop_scanning,
	subscribe_to_characteristic: subscribe_to_characteristic,
	utils: {
		time_limit_promise: time_limit_promise,
	},
};
