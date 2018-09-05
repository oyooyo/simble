'use strict';
var Characteristic, EventEmitter, Peripheral, Service, address_filter, advertised_service_filter, advertised_services_filter, buffer_to_byte_array, canonicalize_bluetooth_uuid, canonicalize_hex_string, canonicalize_mac_address, canonicalize_uuid, create_filter, create_sub_filter, first_valid_value, is_valid_value, name_filter, noble, scan_for_peripheral, split_into_chunks, stop_scanning,
  indexOf = [].indexOf;

noble = require('noble');

EventEmitter = require('events');

// Returns true if the passed argument <value> is neither null nor undefined
is_valid_value = function(value) {
  return (value !== void 0) && (value !== null);
};

first_valid_value = function(...values) {
  var i, len, value;
  for (i = 0, len = values.length; i < len; i++) {
    value = values[i];
    if (is_valid_value(value)) {
      return value;
    }
  }
};

buffer_to_byte_array = function(buffer) {
  return [...buffer];
};

canonicalize_hex_string = function(hex_string) {
  return hex_string.replace(/[^0-9A-Fa-f]/g, '').toLowerCase();
};

canonicalize_uuid = function(uuid) {
  var hex;
  hex = canonicalize_hex_string(uuid);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

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

split_into_chunks = function(array, chunk_size) {
  var i, index, ref, ref1, results;
  results = [];
  for (index = i = 0, ref = array.length, ref1 = chunk_size; ref1 !== 0 && (ref1 > 0 ? i < ref : i > ref); index = i += ref1) {
    results.push(array.slice(index, index + chunk_size));
  }
  return results;
};

canonicalize_mac_address = function(mac_address) {
  return split_into_chunks(canonicalize_hex_string(mac_address), 2).join(':');
};

Characteristic = class Characteristic extends EventEmitter {
  constructor(noble_characteristic1, service1) {
    super();
    this.noble_characteristic = noble_characteristic1;
    this.service = service1;
    this.uuid = canonicalize_bluetooth_uuid(this.noble_characteristic.uuid);
    this.noble_characteristic.on('data', (data, is_notification) => {
      this.emit('data', data, is_notification);
    });
    return;
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
    if (!Buffer.isBuffer(data)) {
      data = Buffer.from(data);
    }
    return new Promise((resolve, reject) => {
      this.noble_characteristic.write(data, first_valid_value(without_response, false), (error) => {
        if (error) {
          reject(error);
        } else {
          resolve(this);
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
          this.addListener('data', function(data) {
            return listener(buffer_to_byte_array(data));
          });
          resolve(this);
        }
      });
    });
  }

};

Service = class Service extends EventEmitter {
  constructor(noble_service1, peripheral1) {
    super();
    this.noble_service = noble_service1;
    this.peripheral = peripheral1;
    this.uuid = canonicalize_bluetooth_uuid(this.noble_service.uuid);
    this.characteristics = {};
    this.update_characteristics();
    return;
  }

  update_characteristics() {
    var characteristic_uuid, i, len, noble_characteristic, ref;
    if (this.noble_service.characteristics) {
      ref = this.noble_service.characteristics;
      for (i = 0, len = ref.length; i < len; i++) {
        noble_characteristic = ref[i];
        characteristic_uuid = canonicalize_bluetooth_uuid(noble_characteristic.uuid);
        if (!this.characteristics.hasOwnProperty(characteristic_uuid)) {
          this.characteristics[characteristic_uuid] = new Characteristic(noble_characteristic, this);
        }
      }
    }
  }

  ensure_discovered() {
    return new Promise((resolve, reject) => {
      return this.peripheral.ensure_discovered().then(() => {
        resolve(this);
      });
    });
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

Peripheral = class Peripheral extends EventEmitter {
  constructor(noble_peripheral1) {
    super();
    this.noble_peripheral = noble_peripheral1;
    this.address = canonicalize_mac_address(this.noble_peripheral.address);
    this.address_type = this.noble_peripheral.addressType;
    this.services = {};
    this.update_services();
    this.connectable = this.noble_peripheral.connectable;
    this.rssi = this.noble_peripheral.rssi;
    this.advertisement = {
      name: this.noble_peripheral.advertisement.localName,
      service_uuids: this.noble_peripheral.advertisement.serviceUuids.map(canonicalize_bluetooth_uuid),
      manufacturer_data: this.noble_peripheral.advertisement.manufacturerData
    };
    this.is_discovered = false;
    this.is_connected = false;
    this.noble_peripheral.on('connect', () => {
      this.is_connected = true;
      this.emit('connected');
    });
    this.noble_peripheral.on('disconnect', () => {
      this.is_connected = false;
      this.emit('disconnected');
    });
    this.noble_peripheral.on('rssiUpdate', (rssi) => {
      this.rssi = rssi;
      this.emit('rssi_update', rssi);
    });
    return;
  }

  update_services() {
    var i, len, noble_service, ref, service_uuid;
    if (this.noble_peripheral.services) {
      ref = this.noble_peripheral.services;
      for (i = 0, len = ref.length; i < len; i++) {
        noble_service = ref[i];
        service_uuid = canonicalize_bluetooth_uuid(noble_service.uuid);
        if (!this.services.hasOwnProperty(service_uuid)) {
          this.services[service_uuid] = new Service(noble_service, this);
        }
      }
    }
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.noble_peripheral.connect((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(this);
        }
      });
    });
  }

  disconnect() {
    return new Promise((resolve, reject) => {
      this.noble_peripheral.disconnect((error) => {
        if (error) {
          reject(error);
        } else {
          resolve(this);
        }
      });
    });
  }

  ensure_connected() {
    if (this.is_connected) {
      return Promise.resolve(this);
    } else {
      return this.connect();
    }
  }

  discover() {
    return new Promise((resolve, reject) => {
      this.noble_peripheral.discoverAllServicesAndCharacteristics((error) => {
        if (error) {
          reject(error);
        } else {
          this.update_services();
          this.is_discovered = true;
          this.emit('discovered');
          resolve(this);
        }
      });
    });
  }

  ensure_discovered() {
    return this.ensure_connected().then(() => {
      if (this.is_discovered) {
        return Promise.resolve(this);
      } else {
        return this.discover();
      }
    });
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

address_filter = function(address) {
  address = canonicalize_mac_address(address);
  return function(peripheral) {
    return peripheral.address === address;
  };
};

name_filter = function(name) {
  return function(peripheral) {
    return peripheral.advertisement.name === name;
  };
};

advertised_service_filter = function(service_id) {
  var service_uuid;
  service_uuid = canonicalize_bluetooth_uuid(service_id);
  return function(peripheral) {
    return indexOf.call(peripheral.advertisement.service_uuids, service_uuid) >= 0;
  };
};

advertised_services_filter = function(service_ids) {
  var service_uuids;
  service_uuids = service_ids.map(canonicalize_bluetooth_uuid);
  return function(peripheral) {
    var i, len, servcice_uuid;
    for (i = 0, len = service_uuids.length; i < len; i++) {
      servcice_uuid = service_uuids[i];
      if (!(indexOf.call(peripheral.advertisement.service_uuids, service_uuid) >= 0)) {
        return false;
      }
    }
    return true;
  };
};

create_sub_filter = function(key, value) {
  if (value === null) {
    return function() {
      return true;
    };
  } else {
    return {
      address: mac_address_filter,
      name: name_filter,
      service: advertised_service_filter,
      services: advertised_services_filter
    }[key](value);
  }
};

create_filter = function(options) {
  var key, sub_filters, value;
  sub_filters = (function() {
    var results;
    results = [];
    for (key in options) {
      value = options[key];
      results.push(create_sub_filter(key, value));
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

scan_for_peripheral = function(peripheral_filter) {
  if (typeof peripheral_filter !== 'function') {
    peripheral_filter = create_filter(peripheral_filter);
  }
  return new Promise(function(resolve, reject) {
    noble.on('stateChange', function(state) {
      if (state === 'poweredOn') {
        noble.on('discover', function(noble_peripheral) {
          var peripheral;
          peripheral = new Peripheral(noble_peripheral);
          if (peripheral_filter(peripheral)) {
            resolve(peripheral);
            noble.stopScanning();
          }
        });
        noble.startScanning();
      } else {
        noble.stopScanning();
        reject('Not powered');
      }
    });
    noble.once('scanStop', function() {
      reject('scanning stopped');
    });
  });
};

stop_scanning = function() {
  return new Promise(function(resolve, reject) {
    noble.once('scanStop', function() {
      resolve();
    });
    noble.stopScanning();
  });
};

module.exports = {
  canonicalize: {
    bluetooth_uuid: canonicalize_bluetooth_uuid,
    address: canonicalize_mac_address
  },
  filter: {
    address: address_filter,
    name: name_filter,
    service: advertised_service_filter,
    services: advertised_services_filter
  },
  scan_for_peripheral: scan_for_peripheral,
  stop_scanning: stop_scanning
};

//# sourceMappingURL=simble.js.map
