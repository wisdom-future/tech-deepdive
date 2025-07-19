/**
 * @file test.layer02.DataConnectorLayer.js
 * @description [集成测试] 测试数据连接层 (DataConnector) 的适配能力。
 */

function runDataConnectorLayerTests() {
  return TestRunner.runSuite('Layer 02: Data Connector Layer', [
    test_L02_A_FetchExternalData_BuildsCorrectUrl
  ]);
}

function test_L02_A_FetchExternalData_BuildsCorrectUrl() {
  let capturedUrl = '';
  const originalFetch = UrlFetchApp.fetch;
  UrlFetchApp.fetch = (url, options) => {
    capturedUrl = url;
    return { getResponseCode: () => 200, getContentText: () => '{}' };
  };
  
  const sourceConfig = MockFactory.createMockSourceConfig('news');
  DataConnector.fetchExternalData(sourceConfig, 'everything', { q: 'AI' });
  
  assert.ok(capturedUrl.includes('q=AI'), 'URL应包含动态参数q');
  
  UrlFetchApp.fetch = originalFetch;
}
