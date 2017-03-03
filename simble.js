var Characteristic, Device, EventEmitter, Server, Service, convert_id, noble, request_characteristic, request_device, request_server, request_service;

noble = require('noble');

EventEmitter = require('events');

convert_id = function(id) {
  switch (typeof id) {
    case 'string':
      return id;
    case 'number':
      return id.toString(0x10);
  }
};

Characteristic = (function() {
  function Characteristic(noble_characteristic, service1) {
    this.noble_characteristic = noble_characteristic;
    this.service = service1;
    this.event_emitter = new EventEmitter();
    this.noble_characteristic.on('data', (function(_this) {
      return function(data, is_notification) {
        var event;
        event = {
          target: {
            value: data
          }
        };
        return _this.event_emitter.emit('characteristicvaluechanged', event);
      };
    })(this));
  }

  Characteristic.prototype.addEventListener = function(event_id, event_listener) {
    this.event_emitter.on(event_id, event_listener);
    return Promise.resolve(this);
  };

  Characteristic.prototype.readValue = function() {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_characteristic.read(function(error, data) {
          if (error) {
            return reject(error);
          } else {
            return resolve(data);
          }
        });
      };
    })(this));
  };

  Characteristic.prototype.writeValue = function(data) {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_characteristic.writeValue(data, function(error) {
          if (error) {
            return reject(error);
          } else {
            return resolve(_this);
          }
        });
      };
    })(this));
  };

  Characteristic.prototype.startNotifications = function() {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_characteristic.notify(true, function(error) {
          if (error) {
            return reject(error);
          } else {
            return resolve(_this);
          }
        });
      };
    })(this));
  };

  Characteristic.prototype.subscribe = function(listener) {
    return this.startNotifications().then(this.addEventListener('characteristicvaluechanged', listener));
  };

  return Characteristic;

})();

Service = (function() {
  function Service(noble_service) {
    this.noble_service = noble_service;
  }

  Service.prototype.getCharacteristic = function(characteristic_id) {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_service.discoverCharacteristics([convert_id(characteristic_id)], function(error, noble_characteristics) {
          if (error) {
            return reject(error);
          } else {
            return resolve(new Characteristic(noble_characteristics[0], _this));
          }
        });
      };
    })(this));
  };

  return Service;

})();

Server = (function() {
  function Server(noble_peripheral) {
    this.noble_peripheral = noble_peripheral;
  }

  Server.prototype.connect = function() {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_peripheral.connect(function(error) {
          if (error) {
            return reject(error);
          } else {
            return resolve(_this);
          }
        });
      };
    })(this));
  };

  Server.prototype.disconnect = function() {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_peripheral.disconnect(function(error) {
          if (error) {
            return reject(error);
          } else {
            return resolve(_this);
          }
        });
      };
    })(this));
  };

  Server.prototype.getPrimaryService = function(service_id) {
    return new Promise((function(_this) {
      return function(resolve, reject) {
        return _this.noble_peripheral.discoverServices([convert_id(service_id)], function(error, noble_services) {
          if (error) {
            return reject(error);
          } else {
            return resolve(new Service(noble_services[0]));
          }
        });
      };
    })(this));
  };

  return Server;

})();

Device = (function() {
  function Device(noble_peripheral) {
    this.noble_peripheral = noble_peripheral;
    this.name = this.noble_peripheral.advertisement.localName;
    this.gatt = new Server(this.noble_peripheral);
    this.event_emitter = new EventEmitter();
    this.noble_peripheral.once('disconnect', (function(_this) {
      return function() {
        var event;
        event = {
          target: _this
        };
        return _this.event_emitter.emit('gattserverdisconnected', event);
      };
    })(this));
  }

  Device.prototype.addEventListener = function(event_id, event_listener) {
    this.event_emitter.on(event_id, event_listener);
    return Promise.resolve(this);
  };

  return Device;

})();

request_device = function(options) {
  return new Promise(function(resolve, reject) {
    return noble.on('stateChange', function(state) {
      if (state === 'poweredOn') {
        noble.on('discover', function(peripheral) {
          return resolve(new Device(peripheral));
        });
        return noble.startScanning(options.filters.services);
      } else {
        return noble.stopScanning();
      }
    });
  });
};

request_server = function(options) {
  return request_device(options).then(function(device) {
    return device.gatt.connect();
  });
};

request_service = function(service_id, options) {
  return request_server(options || {
    filters: [
      {
        services: [service_id]
      }
    ]
  }).then(function(server) {
    return server.getPrimaryService(service_id);
  });
};

request_characteristic = function(characteristic_id, service_id, options) {
  return request_service(service_id, options).then(function(service) {
    return service.getCharacteristic(characteristic_id);
  });
};

module.exports = {
  requestDevice: request_device,
  requestServer: request_server,
  requestService: request_service,
  requestCharacteristic: request_characteristic
};

//# sourceMappingURL=simble.js.map
