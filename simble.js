'use strict';
var Characteristic, EventEmitter, Peripheral, Service, address_filter, advertised_services_filter, buffer_to_byte_array, byte_array_to_hex_string, canonicalize_bluetooth_uuid, canonicalize_hex_string, canonicalize_mac_address, canonicalize_uuid, convert_to_buffer, create_filter_function, debug_data, debug_event, ensure_noble_state, filter_types, first_valid_value, integer_to_zero_prefixed_hex_string, is_array, is_function_type, is_of_type, is_valid_value, name_filter, noble, peripheral_states, scan_for_peripheral, split_into_chunks, stop_scanning,
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

// Returns a filter function according to <options>. <options> must either be a function, in which case the function is simply returned, or an object like {"name":"btleperipheral", "services":[0x1827]}, with valid peripheral filter type ids as keys, and the parameter for that peripheral filter type as values.
create_filter_function = function(options) {
  var filter_type, filter_value, sub_filters;
  if (is_function_type(options)) {
    return options;
  }
  sub_filters = (function() {
    var results;
    results = [];
    for (filter_type in options) {
      filter_value = options[filter_type];
      results.push(filter_types[filter_type](filter_value));
    }
    return results;
  })();
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

// Import/Require the "noble" module for Bluetooth LE communication
noble = require('noble');

// Returns a promise that resolves is the state is noble is <noble_state_string>
ensure_noble_state = function(noble_state_string) {
  return new Promise(function(resolve, reject) {
    if (noble.state === noble_state_string) {
      resolve();
    } else {
      noble.on('stateChange', function(state) {
        if (state === noble_state_string) {
          resolve();
        }
      });
    }
  });
};

// Debug log function for events
debug_event = require('debug')('simble:event');

// Import/Require the "events" module as EventEmitter
EventEmitter = require('events');

// The possible states a peripheral can have
peripheral_states = {
  disconnected: 1,
  connected: 2,
  discovered: 3
};

// Convert a Buffer instance <buffer> to an array of byte integers
buffer_to_byte_array = function(buffer) {
  return [...buffer];
};

// Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = function(value) {
  return (value !== void 0) && (value !== null);
};

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
  constructor(noble_characteristic1, service1) {
    super();
    this.noble_characteristic = noble_characteristic1;
    this.service = service1;
    this.uuid = canonicalize_bluetooth_uuid(this.noble_characteristic.uuid);
    this.noble_characteristic.on('data', (data) => {
      data = buffer_to_byte_array(data);
      debug_data(`Characteristic ${this.uuid} : Receive "${byte_array_to_hex_string(data, ' ')}"`);
      this.emit('data_received', data);
    });
    return;
  }

  emit(event_id) {
    debug_event(`Characteristic ${this.uuid} : Event "${event_id}"`);
    return super.emit(...arguments);
  }

  read() {
    return new Promise((resolve, reject) => {
      this.noble_characteristic.read((error, data) => {
        if (error) {
          reject(error);
        } else {
          resolve(buffer_to_byte_array(data));
        }
      });
    });
  }

  write(data, without_response) {
    data = convert_to_buffer(data);
    without_response = first_valid_value(without_response, false);
    debug_data(`Characteristic ${this.uuid} : Send "${byte_array_to_hex_string(data, ' ')}"`);
    return new Promise((resolve, reject) => {
      this.noble_characteristic.write(data, without_response, (error) => {
        if (error) {
          reject(error);
        } else {
          resolve();
        }
      });
    });
  }

  subscribe(listener) {
    return new Promise((resolve, reject) => {
      this.noble_characteristic.subscribe((error) => {
        if (error) {
          reject(error);
        } else {
          this.addListener('data_received', listener);
          resolve();
        }
      });
    });
  }

};

// This class represents a Bluetooth LE service
Service = class extends EventEmitter {
  constructor(noble_service1, peripheral1) {
    super();
    this.noble_service = noble_service1;
    this.peripheral = peripheral1;
    this.uuid = canonicalize_bluetooth_uuid(this.noble_service.uuid);
    this.update_characteristics();
    return;
  }

  emit(event_id) {
    debug_event(`Service ${this.uuid} : Event "${event_id}"`);
    return super.emit(...arguments);
  }

  update_characteristics() {
    var i, len, noble_characteristic, ref;
    this.characteristics = {};
    if (this.noble_service.characteristics) {
      ref = this.noble_service.characteristics;
      for (i = 0, len = ref.length; i < len; i++) {
        noble_characteristic = ref[i];
        this.characteristics[canonicalize_bluetooth_uuid(noble_characteristic.uuid)] = new Characteristic(noble_characteristic, this);
      }
    }
  }

  ensure_discovered() {
    return this.peripheral.ensure_discovered();
  }

  get_discovered_characteristic(characteristic_id) {
    return this.characteristics[canonicalize_bluetooth_uuid(characteristic_id)];
  }

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
    constructor(noble_peripheral1) {
      super();
      this.noble_peripheral = noble_peripheral1;
      this.address = canonicalize_mac_address(this.noble_peripheral.address);
      this.address_type = this.noble_peripheral.addressType;
      this.advertisement = {
        name: this.noble_peripheral.advertisement.localName,
        service_uuids: this.noble_peripheral.advertisement.serviceUuids.map(canonicalize_bluetooth_uuid),
        manufacturer_data: this.noble_peripheral.advertisement.manufacturerData
      };
      this.connectable = this.noble_peripheral.connectable;
      this.rssi = this.noble_peripheral.rssi;
      // TODO is this safe? could noble_peripheral already be connected?
      this.set_state(peripheral_states.disconnected);
      this.update_services();
      this.noble_peripheral.on('connect', () => {
        this.set_state(peripheral_states.connected);
        this.emit('connected');
      });
      this.noble_peripheral.on('disconnect', () => {
        this.set_state(peripheral_states.disconnected);
        this.emit('disconnected');
      });
      this.noble_peripheral.on('rssiUpdate', (rssi) => {
        this.rssi = rssi;
        this.emit('rssi_update', rssi);
      });
      return;
    }

    emit(event_id) {
      debug_event(`Peripheral ${this.address} : Event "${event_id}"`);
      return super.emit(...arguments);
    }

    set_state(state) {
      if (state !== this.state) {
        this.state = state;
        this.is_connected = state >= peripheral_states.connected;
        this.is_discovered = state >= peripheral_states.discovered;
      }
    }

    update_services() {
      var i, len, noble_service, ref;
      this.services = {};
      if (this.noble_peripheral.services) {
        ref = this.noble_peripheral.services;
        for (i = 0, len = ref.length; i < len; i++) {
          noble_service = ref[i];
          this.services[canonicalize_bluetooth_uuid(noble_service.uuid)] = new Service(noble_service, this);
        }
      }
    }

    ensure_disconnected() {
      return new Promise((resolve, reject) => {
        if (!this.is_connected) {
          resolve();
        } else {
          this.noble_peripheral.disconnect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }
      });
    }

    // Alias for ensure_disconnected()
    disconnect() {
      return this.ensure_disconnected();
    }

    ensure_connected() {
      return new Promise((resolve, reject) => {
        if (this.is_connected) {
          resolve();
        } else {
          this.noble_peripheral.connect((error) => {
            if (error) {
              reject(error);
            } else {
              resolve();
            }
          });
        }
      });
    }

    // Alias for ensure_connected()
    connect() {
      return this.ensure_connected();
    }

    ensure_discovered() {
      return this.ensure_connected().then(() => {
        return new Promise((resolve, reject) => {
          if (this.is_discovered) {
            resolve();
          } else {
            this.noble_peripheral.discoverAllServicesAndCharacteristics((error) => {
              if (error) {
                reject(error);
              } else {
                this.update_services();
                this.set_state(peripheral_states.discovered);
                this.emit('discovered');
                resolve();
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

    get_discovered_service(service_id) {
      return this.services[canonicalize_bluetooth_uuid(service_id)];
    }

    get_service(service_id) {
      return this.ensure_discovered().then(() => {
        return this.get_discovered_service(service_id);
      });
    }

    get_characteristic(service_id, characteristic_id) {
      return this.get_service(service_id).then(function(service) {
        return service.get_characteristic(characteristic_id);
      });
    }

  };

  _Class.states = peripheral_states;

  return _Class;

}).call(this);

// Scan for a peripheral that matches the filter <peripheral_filter>. Returns a Promise that resolves to the peripheral if found
scan_for_peripheral = function(peripheral_filter) {
  peripheral_filter = create_filter_function(peripheral_filter);
  return ensure_noble_state('poweredOn').then(function() {
    return new Promise(function(resolve, reject) {
      noble.on('discover', function(noble_peripheral) {
        var peripheral;
        peripheral = new Peripheral(noble_peripheral);
        if (peripheral_filter(peripheral)) {
          noble.stopScanning();
          resolve(peripheral);
        }
      });
      noble.startScanning();
    });
  });
};

// Stop scanning for peripherals. Returns a Promise that resolves if the scanning has stopped.
stop_scanning = function() {
  return new Promise(function(resolve, reject) {
    noble.once('scanStop', function() {
      resolve();
    });
    noble.stopScanning();
  });
};

// What this module exports
module.exports = {
  canonicalize: {
    address: canonicalize_mac_address,
    bluetooth_uuid: canonicalize_bluetooth_uuid
  },
  filter: filter_types,
  scan_for_peripheral: scan_for_peripheral,
  stop_scanning: stop_scanning
};

//# sourceMappingURL=simble.js.map
