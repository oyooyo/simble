'use strict';
var Characteristic, EventEmitter, Peripheral, Service, address_filter, advertised_services_filter, buffer_to_byte_array, byte_array_to_hex_string, canonicalize_bluetooth_uuid, canonicalize_hex_string, canonicalize_mac_address, canonicalize_uuid, connect_to_characteristic, connect_to_peripheral, connect_to_service, convert_to_buffer, create_filter_function, debug_data, debug_event, debug_info, discover_peripheral, ensure_noble_state, filter_types, first_valid_value, get_timestamp_millis, integer_to_zero_prefixed_hex_string, is_array, is_function_type, is_of_type, is_valid_value, name_filter, noble, peripheral_states, publish_to_characteristic, register_temporary_event_listener, scan_for_peripheral, split_into_chunks, stop_scanning, subscribe_to_characteristic, time_limit_promise,
  indexOf = [].indexOf;

// Canonicalize hexadecimal string <hex_string> by removing all non-hexadecimal characters, and converting all hex digits to lower case
canonicalize_hex_string = function(hex_string) {
  return hex_string.replace(/[^0-9A-Fa-f]/g, '').toLowerCase();
};

// Canonicalize UUID string <uuid>
canonicalize_uuid = function(uuid) {
  var hex;
  hex = canonicalize_hex_string(uuid);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

// Canonicalize bluetooth UUID <uuid> (which may be an integer or a hexadecimal string), by converting it to a canonical, 36 characters long UUID string
canonicalize_bluetooth_uuid = function(uuid) {
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
split_into_chunks = function(slicable, chunk_length) {
  var i, index, ref, ref1, results;
  results = [];
  for (index = i = 0, ref = slicable.length, ref1 = chunk_length; ref1 !== 0 && (ref1 > 0 ? i < ref : i > ref); index = i += ref1) {
    results.push(slicable.slice(index, index + chunk_length));
  }
  return results;
};

// Canonicalize the MAC address <mac_address> (a string)
canonicalize_mac_address = function(mac_address) {
  return split_into_chunks(canonicalize_hex_string(mac_address), 2).join(':');
};

// Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <address>
address_filter = function(address) {
  address = canonicalize_mac_address(address);
  return function(peripheral) {
    return peripheral.address === address;
  };
};

// Returns true if <value> is an array
is_array = function(value) {
  return Array.isArray(value);
};

// Returns a peripheral filter function with argument <peripheral> that returns true if all service IDs in <service_ids> are in the list of services that peripheral <peripheral> advertises
advertised_services_filter = function(service_ids) {
  var service_uuids;
  if (!is_array(service_ids)) {
    service_ids = [service_ids];
  }
  service_uuids = service_ids.map(canonicalize_bluetooth_uuid);
  return function(peripheral) {
    var i, len, service_uuid;
    for (i = 0, len = service_uuids.length; i < len; i++) {
      service_uuid = service_uuids[i];
      if (!(indexOf.call(peripheral.advertisement.service_uuids, service_uuid) >= 0)) {
        return false;
      }
    }
    return true;
  };
};

// Returns a peripheral filter function with argument <peripheral> that returns true if the address of <peripheral> equals <name>
name_filter = function(name) {
  return function(peripheral) {
    return peripheral.advertisement.name === name;
  };
};

// The various filter types
filter_types = {
  address: address_filter,
  name: name_filter,
  service: advertised_services_filter,
  services: advertised_services_filter
};

// Returns a function with argument <value> that returns true if <value> is of type <type_string>, false otherwise
is_of_type = function(type_string) {
  return function(value) {
    return typeof value === type_string;
  };
};

// Returns true if the passed argument <value> is of type "function", false otherwise
is_function_type = is_of_type('function');

// Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = function(value) {
  return !((value === void 0) || (value === null));
};

// Returns a filter function according to <options>. <options> must either be a function, in which case the function is simply returned, or an object like {"name":"btleperipheral", "services":[0x1827]}, with valid peripheral filter type ids as keys, and the parameter for that peripheral filter type as values. If one of the values is null or undefined, this sub filter will be skipped.
create_filter_function = function(options) {
  var filter_type, filter_value, sub_filters;
  if (is_function_type(options)) {
    return options;
  }
  sub_filters = [];
  for (filter_type in options) {
    filter_value = options[filter_type];
    if (is_valid_value(filter_value)) {
      sub_filters.push(filter_types[filter_type](filter_value));
    }
  }
  return function(peripheral) {
    var i, len, sub_filter;
    for (i = 0, len = sub_filters.length; i < len; i++) {
      sub_filter = sub_filters[i];
      if (!sub_filter(peripheral)) {
        return false;
      }
    }
    return true;
  };
};

// Debug log function for info
debug_info = require('debug')('simble:info');

// Import/Require the "noble" module for Bluetooth LE communication
noble = require('noble');

// Register a temporary event listener <event_listener> for event <event_name> on event emitter <event_emitter>.
// If the event emitter returns the boolean value true, the event listener will be removed
register_temporary_event_listener = function(event_emitter, event_name, event_listener) {
  var event_listener_proxy;
  event_listener_proxy = function(...event_args) {
    var event_listener_return_value;
    event_listener_return_value = event_listener(...event_args);
    if (event_listener_return_value === true) {
      event_emitter.removeListener(event_name, event_listener_proxy);
    }
  };
  event_emitter.on(event_name, event_listener_proxy);
};

// Returns a promise that resolves is the state is noble is <noble_state_string>
ensure_noble_state = function(noble_state_string) {
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
buffer_to_byte_array = function(buffer) {
  if (!is_valid_value(buffer)) {
    return null;
  }
  return [...buffer];
};

// Debug log function for events
debug_event = require('debug')('simble:event');

// Import/Require the "events" module as EventEmitter
EventEmitter = require('events');

// Returns the first value in <values...> that is neither null nor undefined
first_valid_value = function(...values) {
  var i, len, value;
  for (i = 0, len = values.length; i < len; i++) {
    value = values[i];
    if (is_valid_value(value)) {
      return value;
    }
  }
};

// Returns the current timestamp, as milliseconds since the epoch
get_timestamp_millis = function() {
  return Date.now();
};

// The possible states a peripheral can have
peripheral_states = {
  DISCONNECTED: 1,
  CONNECTED: 2,
  DISCOVERED: 3
};

// Converts integer value <integer> into a zero-prefixed hexadecimal string of length <number_of_digits>
integer_to_zero_prefixed_hex_string = function(integer, number_of_digits) {
  return ('0'.repeat(number_of_digits) + integer.toString(0x10)).slice(-number_of_digits);
};

// Convert the byte array <byte_array> to a hexadecimal string. Every byte value is converted to a two-digit, zero padded hexadecimal string, prefixed with string <prefix_string> (default:""), suffixed with string <suffix_string> (default:""). All bytes are separated with string <separator_string> (default:" ")
byte_array_to_hex_string = function(byte_array, separator_string, prefix_string, suffix_string) {
  var byte;
  separator_string = first_valid_value(separator_string, ' ');
  prefix_string = first_valid_value(prefix_string, '');
  suffix_string = first_valid_value(suffix_string, '');
  return ((function() {
    var i, len, results;
    results = [];
    for (i = 0, len = byte_array.length; i < len; i++) {
      byte = byte_array[i];
      results.push(`${prefix_string}${integer_to_zero_prefixed_hex_string(byte, 2)}${suffix_string}`);
    }
    return results;
  })()).join(separator_string);
};

// Convert <value> to a Buffer instance
convert_to_buffer = function(value) {
  if (!Buffer.isBuffer(value)) {
    value = Buffer.from(value);
  }
  return value;
};

// Debug log function for data that is being transferred
debug_data = require('debug')('simble:data');

// This class represents a Bluetooth LE characteristic
Characteristic = class extends EventEmitter {
  // Constructor, instantiates a new Characteristic instance
  constructor(noble_characteristic, service1) {
    super();
    this.service = service1;
    this.peripheral = this.service.peripheral;
    this.set_noble_characteristic(noble_characteristic);
    return;
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
      without_response = first_valid_value(without_response, false);
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
Service = class extends EventEmitter {
  // Constructor, instantiates a new Service instance
  constructor(noble_service, peripheral1) {
    super();
    this.peripheral = peripheral1;
    this.set_noble_service(noble_service);
    return;
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
    var characteristic, characteristic_uuid, i, len, noble_characteristic, ref;
    this.old_characteristics = first_valid_value(this.characteristics, {});
    this.characteristics = {};
    if (this.noble_service.characteristics) {
      ref = this.noble_service.characteristics;
      for (i = 0, len = ref.length; i < len; i++) {
        noble_characteristic = ref[i];
        characteristic_uuid = canonicalize_bluetooth_uuid(noble_characteristic.uuid);
        characteristic = this.old_characteristics[characteristic_uuid];
        if (is_valid_value(characteristic)) {
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
Peripheral = (function() {
  var _Class;

  _Class = class extends EventEmitter {
    // Constructor, instantiates a new Peripheral instance
    constructor(noble_peripheral) {
      super();
      this.set_auto_disconnect_time(0);
      this.set_noble_peripheral(noble_peripheral);
      return;
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
      var advertisement;
      if (noble_peripheral !== this.noble_peripheral) {
        //if (@noble_peripheral isnt null)
        this.noble_peripheral = noble_peripheral;
        if (noble_peripheral !== null) {
          this.address = canonicalize_mac_address(this.noble_peripheral.address);
          this.address_type = this.noble_peripheral.addressType;
          advertisement = this.noble_peripheral.advertisement;
          this.advertisement = {
            manufacturer_data: buffer_to_byte_array(advertisement.manufacturerData),
            name: advertisement.localName,
            service_data: advertisement.serviceData.map(function(service_data) {
              return {
                uuid: canonicalize_bluetooth_uuid(service_data.uuid),
                data: buffer_to_byte_array(service_data.data)
              };
            }),
            service_solicitation_uuids: (advertisement.serviceSolicitationUuid ? advertisement.serviceSolicitationUuid.map(canonicalize_bluetooth_uuid) : []),
            service_uuids: advertisement.serviceUuids.map(canonicalize_bluetooth_uuid),
            tx_power_level: advertisement.txPowerLevel
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
        this.is_connected = state >= peripheral_states.CONNECTED;
        this.is_discovered = state >= peripheral_states.DISCOVERED;
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
      var i, len, noble_service, ref, service, service_uuid;
      this.old_services = first_valid_value(this.services, {});
      this.services = {};
      if (this.noble_peripheral.services) {
        ref = this.noble_peripheral.services;
        for (i = 0, len = ref.length; i < len; i++) {
          noble_service = ref[i];
          service_uuid = canonicalize_bluetooth_uuid(noble_service.uuid);
          service = this.old_services[service_uuid];
          if (is_valid_value(service)) {
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
        if (!this.is_connected) {
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
              var characteristic, characteristic_uuid, ref, ref1, service, service_uuid;
              if (error) {
                reject(error);
              } else {
                this.update_services();
                debug_info(`Peripheral ${this.address} discovered:`);
                ref = this.services;
                for (service_uuid in ref) {
                  service = ref[service_uuid];
                  debug_info(`  Service ${service.uuid}`);
                  ref1 = service.characteristics;
                  for (characteristic_uuid in ref1) {
                    characteristic = ref1[characteristic_uuid];
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

  };

  // The possible states a peripheral can have
  _Class.STATES = peripheral_states;

  return _Class;

}).call(this);

// Scan for a peripheral that matches the filter <peripheral_filter>. Returns a Promise that resolves to the peripheral if found
scan_for_peripheral = function(peripheral_filter) {
  peripheral_filter = create_filter_function(peripheral_filter);
  return ensure_noble_state('poweredOn').then(function() {
    return new Promise(function(resolve, reject) {
      register_temporary_event_listener(noble, 'discover', function(noble_peripheral) {
        var peripheral;
        peripheral = new Peripheral(noble_peripheral);
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
connect_to_service = function(service_id) {
  return scan_for_peripheral({
    service: service_id
  }).then(function(peripheral) {
    return peripheral.get_service(service_id);
  });
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Returns a Promise that resolves to the characteristic with ID <characteristic_id> of that service
connect_to_characteristic = function(service_id, characteristic_id) {
  return connect_to_service(service_id).then(function(service) {
    return service.get_characteristic(characteristic_id);
  });
};

// Scan for a peripheral that matches the filter <peripheral_filter> and connect to it. Returns a Promise that resolves to the peripheral
connect_to_peripheral = function(peripheral_filter) {
  return scan_for_peripheral(peripheral_filter).then(function(peripheral) {
    return peripheral.ensure_connected();
  });
};

// Scan for a peripheral that matches the filter <peripheral_filter>, connect and discover it. Returns a Promise that resolves to the peripheral
discover_peripheral = function(peripheral_filter) {
  return scan_for_peripheral(peripheral_filter).then(function(peripheral) {
    return peripheral.ensure_discovered();
  });
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Publish the data <data> to the characteristic with ID <characteristic_id> of that service. If <without_response> is set to true, the data will be published without requiring a confirmation response. Returns a Promise that resolves when the data was published
publish_to_characteristic = function(service_id, characteristic_id, data, without_response) {
  return connect_to_characteristic(service_id, characteristic_id).then(function(characteristic) {
    return characteristic.write(data, without_response);
  });
};

// Stop scanning for peripherals. Returns a Promise that resolves if the scanning has stopped.
stop_scanning = function() {
  return new Promise(function(resolve, reject) {
    noble.once('scanStop', function() {
      //noble.removeAllListeners('discover')
      resolve();
    });
    noble.stopScanning();
  });
};

// Scan for a peripheral advertising the service with ID <service_id> and connect to it. Subscribe to the characteristic with ID <characteristic_id> of that service. Returns a Promise that resolves when the subscribing was successful
subscribe_to_characteristic = function(service_id, characteristic_id, subscriber_callback) {
  return connect_to_characteristic(service_id, characteristic_id).then(function(characteristic) {
    return characteristic.subscribe(subscriber_callback);
  });
};

// Returns a promise that is a time-limited wrapper for promise <promise>. If the promise <promise> does not resolve within <time_limit> microseconds, the promise is rejected
time_limit_promise = function(promise, time_limit, timeout_error_message) {
  if (time_limit === 0) {
    return promise;
  }
  timeout_error_message = first_valid_value(timeout_error_message, 'Promise did not resolve within time');
  return new Promise(function(resolve, reject) {
    var timeout;
    timeout = setTimeout(function() {
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
    bluetooth_uuid: canonicalize_bluetooth_uuid
  },
  connect: {
    characteristic: connect_to_characteristic,
    peripheral: connect_to_peripheral,
    service: connect_to_service
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
    time_limit_promise: time_limit_promise
  }
};

//# sourceMappingURL=simble.js.map
