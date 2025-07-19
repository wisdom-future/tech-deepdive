/**
 * @file test.layer01.DataLayer.js
 * @description [集成测试] 测试数据访问层，与真实Firestore交互。
 */

function runDataLayerTests() {
  return TestRunner.runSuite('Layer 01: Data Access Layer', [
    test_L01_A_WriteUpdateDelete,
    test_L01_B_FilterAndGet
  ]);
}

function _pollUntil(conditionFunction, maxAttempts = 5, delay = 1500) {
  for (let i = 0; i < maxAttempts; i++) {
    if (conditionFunction()) return true;
    if (i < maxAttempts - 1) Utilities.sleep(delay);
  }
  return false;
}

function test_L01_A_WriteUpdateDelete() {
    const collectionKey = 'REG_ENTITIES';
    const testId = `test_crud_${Helpers.generateUuid()}`;
    const testData = { entity_id: testId, primary_name: 'Test CRUD' };
    try {
        DataService.batchUpsert(collectionKey, [testData], 'entity_id');
        let found = _pollUntil(() => DataService.getDocument(collectionKey, testId) !== null);
        assert.ok(found, "写入后应能读到文档");
    } finally {
        DataService.deleteObject(collectionKey, testId);
    }
}

function test_L01_B_FilterAndGet() {
    const collectionKey = 'REG_ENTITIES';
    const testId = `test_filter_${Helpers.generateUuid()}`;
    const testData = { entity_id: testId, primary_name: 'Test Filter', entity_type: 'Test' };
    try {
        DataService.batchUpsert(collectionKey, [testData], 'entity_id');
        let data;
        const found = _pollUntil(() => {
          data = DataService.getDataAsObjects(collectionKey, { filters: [{ field: 'entity_id', operator: 'EQUAL', value: testId }] });
          return data.length === 1;
        });
        assert.ok(found, "应能通过筛选查询找到记录");
        if(found) assert.equal(data[0].entity_id, testId, "筛选出的记录ID应正确");
    } finally {
        DataService.deleteObject(collectionKey, testId);
    }
}
