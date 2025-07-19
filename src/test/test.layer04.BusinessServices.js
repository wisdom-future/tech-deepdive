/**
 * @file test.layer04.BusinessServices.js
 * @description [集成测试] 测试所有面向前端的API服务。
 */
function runBusinessServicesTests() {
  return TestRunner.runSuite('Layer 04: Business API Services', [
    test_L04_A_RegistryService_getRegistry
  ]);
}

function test_L04_A_RegistryService_getRegistry() {
  const originalGetData = DataService.getDataAsObjects;
  DataService.getDataAsObjects = () => [MockFactory.createMockEntity()];
  const result = RegistryService.getRegistry('REG_ENTITIES');
  assert.equal(result.total, 1, '应正确统计实体总数');
  DataService.getDataAsObjects = originalGetData;
}
