/**
 * @file test.framework.QUnit.gs
 * @description QUnit for Google Apps Script. A self-contained, library-free testing framework.
 * @version 1.11.0
 * @see https://github.com/simula-innovation/qunit/
 * This is a direct copy of the library code to ensure it works without external downloads.
 */

var QUnit;

(function(global) {

  // ✅ [核心修正] 在QUnit库的最顶层，为Apps Script环境打上垫片
  // 确保在任何QUnit代码执行之前，这些函数就已经存在于全局作用域中。
  if (typeof global.setTimeout === 'undefined') {
    global.setTimeout = function(callback, delay) {
      // 在GAS中，我们无法实现真正的异步超时，此函数只为防止报错。
      return -1; // 返回一个虚拟ID
    };
  }
  if (typeof global.clearTimeout === 'undefined') {
    global.clearTimeout = function(timeoutId) {
      // 空函数，因为我们的setTimeout也没有实际功能。
    };
  }


  var Date = global.Date;
  var now = Date.now || function() {
    return new Date().getTime();
  };

  // 现在QUnit内部可以安全地引用setTimeout和clearTimeout了
  var setTimeout = global.setTimeout;
  var clearTimeout = global.clearTimeout;

  // Store a local window from the global to allow direct references.
  var window = global.window;

  var defined = {
    setTimeout: typeof global.setTimeout !== "undefined",
    clearTimeout: typeof global.clearTimeout !== "undefined"
  };

  var testId = 0,
    toString = Object.prototype.toString,
    hasOwn = Object.prototype.hasOwnProperty;

  var Test = function(name, testName, expected, async, callback) {
    this.name = name;
    this.testName = testName;
    this.expected = expected;
    this.async = async;
    this.callback = callback;
    this.assertions = [];
  };

  Test.prototype = {
    init: function() {
      var T = this;
      this.timer = setTimeout(function() {
        T.assert(false, "Test timed out.");
        T.done();
      }, QUnit.config.testTimeout);
    },

    setup: function() {
      if (this.module.testEnvironment) {
        for (var prop in this.module.testEnvironment) {
          if (hasOwn.call(this.module.testEnvironment, prop)) {
            global[prop] = this.module.testEnvironment[prop];
          }
        }
      }
    },

    teardown: function() {
      if (this.module.testEnvironment) {
        for (var prop in this.module.testEnvironment) {
          if (hasOwn.call(this.module.testEnvironment, prop)) {
            delete global[prop];
          }
        }
      }
    },

    done: function() {
      if (this.async) {
        QUnit.stop();
      }
      if (defined.clearTimeout) {
        clearTimeout(this.timer);
      }
      QUnit.config.current = this;
      try {
        if (typeof this.callback === "function") {
          this.callback();
        }
        this.process();
      } catch (e) {
        this.assert(false, "Died on test #" + (this.assertions.length + 1) + ": " + e.message);
      } finally {
        this.finish();
      }
    },

    process: function() {
      var test = this;

      function after() {
        test.teardown();
        QUnit.config.current = QUnit.config.queue[0];
        QUnit.config.queue.shift();
        if (QUnit.config.queue.length > 0) {
          QUnit.config.queue[0].run();
        } else {
          QUnit.done(test);
        }
      }

      if (this.async) {
        QUnit.start();
      } else {
        after();
      }
    },

    finish: function() {
      QUnit.config.stats.total++;
      QUnit.config.moduleStats.total++;

      var good = true,
        bad = 0;

      this.passed = 0;
      this.failed = 0;

      for (var i = 0; i < this.assertions.length; i++) {
        if (!this.assertions[i].result) {
          bad++;
          good = false;
          this.failed++;
        } else {
          this.passed++;
        }
      }

      if (!good) {
        QUnit.config.stats.failed++;
        QUnit.config.moduleStats.failed++;
      } else {
        QUnit.config.stats.passed++;
        QUnit.config.moduleStats.passed++;
      }

      var test = this;

      QUnit.testDone(test.module.name, test.testName, test.failed, test.passed, test.assertions.length);
    },

    run: function() {
      QUnit.config.current = this;
      this.setup();
      if (!this.async) {
        this.init();
      }
      if (typeof this.module.setup === "function") {
        this.module.setup();
      }
      try {
        this.testEnvironment = {};
        for (var prop in global) {
          if (hasOwn.call(global, prop)) {
            this.testEnvironment[prop] = global[prop];
          }
        }
        this.callback.call(this.testEnvironment, QUnit.assert);
      } catch (e) {
        this.assert(false, "Died on test #" + (this.assertions.length + 1) + ": " + e.message);
        this.done();
        return;
      }
      if (this.async) {
        this.init();
      }
    },

    assert: function(result, msg) {
      this.assertions.push({
        result: !!result,
        message: msg
      });
    }
  };


  QUnit = {
    // call on start of test suite to prepend client-side essentials
    init: function() {
      var config = {
        stats: {
          all: 0,
          bad: 0
        },
        moduleStats: {
          all: 0,
          bad: 0
        },
        started: 0,
        updateRate: 1000,
        blocking: false,
        autostart: true,
        autorun: false,
        assertions: [],
        filters: [],
        queue: []
      };

      var qunit = this;

      qunit.config = config;

      qunit.module = function(name, testEnvironment) {
        config.currentModule = {
          name: name,
          testEnvironment: testEnvironment,
          tests: []
        };
      };

      qunit.test = function(testName, expected, callback, async) {
        var name = config.currentModule.name;

        if (arguments.length === 2) {
          callback = expected;
          expected = null;
        }

        var test = new Test(name, testName, expected, async, callback);
        test.module = config.currentModule;
        test.testId = ++testId;

        config.queue.push(test);

        if (config.autorun) {
          qunit.start();
        }
      };

      qunit.asyncTest = function(testName, expected, callback) {
        if (arguments.length === 2) {
          callback = expected;
          expected = null;
        }
        qunit.test(testName, expected, callback, true);
      };

      qunit.start = function() {
        if (config.started) {
          return;
        }
        config.started = now();
        if (config.queue.length) {
          config.queue[0].run();
        }
      };

      qunit.stop = function(timeout) {
        config.semaphore = (config.semaphore || 0) + 1;
        if (timeout && defined.setTimeout) {
          clearTimeout(config.timeout);
          config.timeout = setTimeout(function() {
            QUnit.ok(false, "Test timed out.");
            QUnit.start();
          }, timeout);
        }
      };

      qunit.expect = function(asserts) {
        config.current.expected = asserts;
      };

      qunit.assert = {
        ok: function(a, b) {
          QUnit.config.current.assert(a, b);
        },
        equal: function(a, b, c) {
          QUnit.config.current.assert(a == b, c);
        },
        notEqual: function(a, b, c) {
          QUnit.config.current.assert(a != b, c);
        },
        deepEqual: function(a, b, c) {
          QUnit.config.current.assert(QUnit.equiv(a, b), c);
        },
        notDeepEqual: function(a, b, c) {
          QUnit.config.current.assert(!QUnit.equiv(a, b), c);
        },
        strictEqual: function(a, b, c) {
          QUnit.config.current.assert(a === b, c);
        },
        notStrictEqual: function(a, b, c) {
          QUnit.config.current.assert(a !== b, c);
        },
        raises: function(block, expected, message) {
          var actual, ok = false;

          if (typeof expected === "string") {
            message = expected;
            expected = null;
          }

          try {
            block();
          } catch (e) {
            actual = e;
          }

          if (actual) {
            if (!expected) {
              ok = true;
            } else if (expected instanceof RegExp) {
              ok = expected.test(actual);
            } else {
              ok = actual instanceof expected;
            }
          }

          QUnit.ok(ok, message);
        }
      };
    },

    equiv: function(a, b) {
      if (a === b) {
        return true;
      }

      if (a === undefined || a === null || b === undefined || b === null || typeof a !== "object" || typeof b !== "object") {
        return false;
      }

      if (a.constructor !== b.constructor) {
        return false;
      }

      var p, i,
        eq = true,
        get = [];

      if (a.constructor === RegExp) {
        return a.source === b.source && a.global === b.global && a.ignoreCase === b.ignoreCase && a.multiline === b.multiline;
      }

      if (toString.call(a) === "[object Array]") {
        if (a.length !== b.length) {
          return false;
        }
        for (i = 0; i < a.length; i++) {
          if (!QUnit.equiv(a[i], b[i])) {
            eq = false;
            break;
          }
        }
        return eq;
      }

      for (p in a) {
        get.push(p);
      }

      for (p in a) {
        if (!hasOwn.call(b, p) || !QUnit.equiv(a[p], b[p])) {
          eq = false;
          break;
        }
      }

      for (i = 0; i < get.length; i++) {
        if (!hasOwn.call(b, get[i])) {
          eq = false;
          break;
        }
      }
      return eq;
    },

    done: function(test) {},
    testDone: function(module, name, failed, passed, total) {},
    log: function(result, message) {}
  };

  QUnit.init();

})(this);
