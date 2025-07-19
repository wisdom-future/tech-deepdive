/**
 * @file test.layer00.ToolsAndUtilities.js
 * @description [单元测试] 测试所有 layer00 的工具 (Helpers, Prompts, DataMapper, DateUtils)。
 */

function runToolsAndUtilitiesTests() {
  return TestRunner.runSuite('Layer 00: Tools & Utilities', [
    test_L00_A_Helpers_normalizeForId,
    test_L00_B_Helpers_generateHash,
    test_L00_C_PromptLibrary_get,
    test_L00_D_DateUtils_formatDate,
    test_L00_E_DataMapper_mapJson,
    test_L00_F_DataMapper_mapXml
  ]);
}

function test_L00_A_Helpers_normalizeForId() {
  assert.equal(Helpers.normalizeForId('Test Name!'), 'test_name', '应处理特殊字符和空格');
}

function test_L00_B_Helpers_generateHash() {
  assert.equal(Helpers.generateHash('test'), '098f6bcd4621d373cade4e832627b4f6', 'MD5哈希应固定');
}
  
function test_L00_C_PromptLibrary_get() {
  assert.ok(PromptLibrary.get('news_analysis_batch').includes('intelligence analyst'), '应获取到新闻模板');
}

function test_L00_D_DateUtils_formatDate() {
  assert.equal(DateUtils.formatDate(new Date('2024-01-01T12:00:00Z')), '2024-01-01', '应正确格式化日期');
}

function test_L00_E_DataMapper_mapJson() {
    const rawItem = { title: 'Test', desc: 'Desc' };
    const mappingRules = { fields: { title: 'title', summary: 'desc' } };
    const mapped = DataMapper.map(rawItem, mappingRules, 'json');
    assert.equal(mapped.summary, 'Desc', 'JSON映射应正确');
}

function test_L00_F_DataMapper_mapXml() {
    const originalXmlService = globalThis.XmlService;
    globalThis.XmlService = MockFactory.createMockXmlService();
    const rawItem = XmlService.parse('<entry/>').getRootElement();
    const mappingRules = { fields: { title: 'title' } };
    const mapped = DataMapper.map(rawItem, mappingRules, 'xml');
    assert.equal(mapped.title, 'Mock XML title', 'XML映射应正确');
    globalThis.XmlService = originalXmlService;
}
