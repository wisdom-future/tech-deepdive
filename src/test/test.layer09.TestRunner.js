/**
 * @file test.framework.TestRunner.gs
 * @description [测试框架] 一个自包含的、功能完整的测试运行器和断言库。
 * [v11.0] 最终版：不再依赖任何外部框架如QUnit。
 */

// ==================================================================
//  全局断言库 (Assertion Library)
// ==================================================================
const assert = {
  /**
   * 断言一个值为真。
   * @param {*} value - 要检查的值。
   * @param {string} message - 断言失败时的消息。
   */
  ok: function(value, message) {
    if (!value) {
      throw new Error(`Assertion Failed: ${message || 'The value is not truthy.'}`);
    }
  },

  /**
   * 断言两个值相等 (使用非严格等于 `==`)。
   */
  equal: function(actual, expected, message) {
    if (actual != expected) {
      throw new Error(`Assertion Failed: ${message || 'Values are not equal.'}\n  Expected: "${expected}"\n  Actual:   "${actual}"`);
    }
  },

  /**
   * 断言两个对象或数组深度相等。
   */
  deepEqual: function(actual, expected, message) {
    const actualJson = JSON.stringify(actual);
    const expectedJson = JSON.stringify(expected);
    if (actualJson !== expectedJson) {
      throw new Error(`Assertion Failed: ${message || 'Objects are not deeply equal.'}\n  Expected: ${expectedJson}\n  Actual:   ${actualJson}`);
    }
  },
  
  /**
   * 断言一个函数块会抛出异常。
   */
  throws: function(block, expectedErrorRegex, message) {
    try {
      block();
      throw new Error(`Assertion Failed: ${message || 'Expected an error to be thrown, but it was not.'}`);
    } catch (e) {
      if (expectedErrorRegex && !expectedErrorRegex.test(e.message)) {
        throw new Error(`Assertion Failed: ${message || 'Error message did not match.'}\n  Expected to match: /${expectedErrorRegex.source}/\n  Actual error: "${e.message}"`);
      }
      this.ok(true, "Error was thrown as expected."); // 这是一个成功的断言
    }
  }
};


// ==================================================================
//  测试运行器 (Test Runner)
// ==================================================================
const TestRunner = {
  
  /**
   * 运行一个测试套件。
   * @param {string} testSuiteName - 测试套件的名称。
   * @param {Array<function>} testCases - 包含所有要执行的测试用例函数的数组。
   */
  runSuite: function(testSuiteName, testCases) {
    const startTime = new Date();
    Logger.log(`\n\n=== [${testSuiteName.toUpperCase()} START] @ ${startTime.toLocaleString()} ===`);
    
    let results = [];
    let allTestsPassed = true;

    for (const testFunction of testCases) {
      let result = { name: testFunction.name, status: '', message: '' };
      try {
        // 每个测试都是独立的，直接执行
        testFunction();
        result.status = '✅ PASSED';
      } catch (e) {
        result.status = '💥 FAILED';
        result.message = e.message + (e.stack ? `\nStack: ${e.stack}` : '');
        allTestsPassed = false;
      }
      results.push(result);
    }
    
    // 打印总结报告
    Logger.log("\n--- [TEST SUITE SUMMARY] ---");
    results.forEach(r => {
      const logMessage = r.message ? `: ${r.message}` : '';
      Logger.log(`${r.status} - ${r.name}${logMessage}`);
    });
    Logger.log("--------------------------");
    if (allTestsPassed) {
      Logger.log(`🎉🎉🎉 ALL ${testSuiteName.toUpperCase()} TESTS PASSED! 🎉🎉🎉`);
    } else {
      Logger.log(`🔥🔥🔥 ONE OR MORE ${testSuiteName.toUpperCase()} TESTS FAILED! PLEASE CHECK LOGS. 🔥🔥🔥`);
    }
    const duration = (new Date().getTime() - startTime.getTime()) / 1000;
    Logger.log(`=== [${testSuiteName.toUpperCase()} END] Total Duration: ${duration.toFixed(2)}s ===`);
    
    return allTestsPassed;
  }
};
