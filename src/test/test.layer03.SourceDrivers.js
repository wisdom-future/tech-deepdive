/**
 * @file test.layer03.SourceDrivers.js
 * @description [集成测试] 测试两个新的Source采集服务。
 * [v3.0] 采用更健壮的MOCK设置与清理。
 */
function runSourceDriversTests() {
  return TestRunner.runSuite('Layer 03: Source Drivers', [
    test_L03_A_TechnologySourceDriver_run,
    test_L03_B_CompanySourceDriver_run
  ]);
}

function setupSourceDriverTest() {
  let capturedTasks = [];
  const originals = {
    Helpers: { ...globalThis.Helpers },
    DataService: { ...globalThis.DataService },
    DataConnector: { ...globalThis.DataConnector },
    DataMapper: { ...globalThis.DataMapper }
  };
  
  globalThis.Helpers.createTasksFromItems = (items, type, sId, tId, sConf) => {
    const tasks = items.map(item => ({ task_type: type, payload: item, trigger_entity_id: tId }));
    capturedTasks = capturedTasks.concat(tasks);
    return tasks.length;
  };
  
  return { capturedTasks, originals };
}

function cleanupSourceDriverTest(originals) {
  Object.assign(globalThis.Helpers, originals.Helpers);
  Object.assign(globalThis.DataService, originals.DataService);
  Object.assign(globalThis.DataConnector, originals.DataConnector);
  Object.assign(globalThis.DataMapper, originals.DataMapper);
}

function test_L03_A_TechnologySourceDriver_run() {
  const { capturedTasks, originals } = setupSourceDriverTest();
  try {
    // MOCK
    globalThis.DataService.getDataAsObjects = (key) => [MockFactory.createMockEntity('Technology')];
    globalThis.DataConnector.getAllActiveSourcesOfType = (type) => [MockFactory.createMockSourceConfig('paper')];
    globalThis.DataConnector.fetchExternalData = () => MockFactory.createMockApiResponse('paper');
    globalThis.DataMapper.getRawItems = (resp, path) => [{title: 'mock paper'}]; // 简化返回
    
    // 执行
    TechnologySourceDriver.run();
    
    // 验证
    assert.ok(capturedTasks.length > 0, '技术驱动器应能成功创建任务');
    assert.equal(capturedTasks[0].task_type, 'ACADEMIC_PAPER', '任务类型应为ACADEMIC_PAPER');
  } finally {
    // 清理
    cleanupSourceDriverTest(originals);
  }
}

function test_L03_B_CompanySourceDriver_run() {
  const { capturedTasks, originals } = setupSourceDriverTest();
  try {
    // MOCK
    globalThis.DataService.getDataAsObjects = (key) => [MockFactory.createMockEntity('Company')];
    globalThis.DataConnector.getAllActiveSourcesOfType = (type) => [MockFactory.createMockSourceConfig('news')];
    globalThis.DataConnector.fetchExternalData = () => MockFactory.createMockApiResponse('news');
    globalThis.DataMapper.getRawItems = (resp, path) => [{title: 'mock news'}]; // 简化返回
    
    // 执行
    CompanySourceDriver.run();
    
    // 验证
    assert.ok(capturedTasks.length > 0, '公司驱动器应能成功创建任务');
    assert.equal(capturedTasks[0].task_type, 'TECH_NEWS', '任务类型应为TECH_NEWS');
  } finally {
    // 清理
    cleanupSourceDriverTest(originals);
  }
}
