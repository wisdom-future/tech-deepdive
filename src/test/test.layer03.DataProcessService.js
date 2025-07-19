/**
 * @file test.layer03.DataProcessService.js
 * @description [集成测试] 只测试瘦身后的处理服务逻辑。
 */
function runDataProcessServiceTests() {
  return TestRunner.runSuite('Layer 03: DataProcessService', [
    test_L03_C_ProcessingService_FullPipe
  ]);
}

async function test_L03_C_ProcessingService_FullPipe() {
  // 由于processTaskQueue是async的，我们需要在这里处理异步
  const result = await new Promise(resolve => {
    // MOCK环境
    const testTask = { id: 'task1', payload: {title: 'Test'}, textForAI: 'Test' };
    DataService.getDataAsObjects = () => [testTask];
    DataConnector.getBatchCompletions = () => MockFactory.createMockAiAnalysisResponse('task1');
    DataConnector.getBatchEmbeddings = () => [[0.1]];
    let capturedWrites = {};
    DataService.batchUpsert = (key, objs) => { capturedWrites[key] = objs; };
    DataService.batchDeleteDocs = () => {};
    
    // 执行
    ProcessingService.processTaskQueue().then(() => {
      // 验证
      assert.ok(capturedWrites['EVD_NEWS'], '应有证据写入');
      assert.ok(capturedWrites['FND_MASTER'], '应有发现写入');
      resolve({passed: true, message: '处理器流水线工作正常。'});
    });
  });
  if (!result.passed) throw new Error(result.message);
}
