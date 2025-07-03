// 文件名: backend/ctrl.Code.gs (最终版 - 强制安全序列化)

function doGet(e) {
  const page = e.parameter.page || 'home';
  const htmlTemplate = HtmlService.createTemplateFromFile('MainContainer.html');
  htmlTemplate.page = page;
  htmlTemplate.params = JSON.stringify(e.parameter);
  return htmlTemplate.evaluate()
    .setTitle('联接技术洞察智能引擎')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1.0');
}

function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * ✅ 最终修正版：在返回前进行手动的、安全地JSON序列化
 */
function callApi(serviceName, methodName, args = []) {
  Logger.log(`*** DEBUG: callApi invoked: ${serviceName}.${methodName} ***`);
  const services = {
    RawDataStatsService: RawDataStatsService,
    InsightLeadStatsService: InsightLeadStatsService,
    ConfigDataService: ConfigDataService,
    SystemHealthStatsService: SystemHealthStatsService,
    CollectionStatsService: CollectionStatsService,
    InsightsService: InsightsService,
    ReportsService: ReportsService,
    WorkflowsService: WorkflowsService,
  };

  let result;

  if (services[serviceName] && typeof services[serviceName][methodName] === 'function') {
    try {
      result = services[serviceName][methodName](...(args || []));
    } catch (e) {
      Logger.log(`执行 ${serviceName}.${methodName} 时捕获到严重错误: ${e.message} \n ${e.stack}`);
      // 即使出错，也返回一个可序列化的错误对象
      result = { error: `在执行 ${serviceName}.${methodName} 时发生服务器内部错误: ${e.message}` };
    }
  } else {
    result = { error: `API call failed: Method '${methodName}' not found on service '${serviceName}'.` };
  }
  
  // ✅ 无论结果如何，都在这里进行最终的、唯一的返回处理
  try {
    // 手动将结果转换为 JSON 字符串。这是最安全的方式，可以处理任何复杂对象。
    return JSON.stringify(result);
  } catch (e) {
    Logger.log(`!!! CRITICAL: 序列化 ${serviceName}.${methodName} 的返回结果时失败: ${e.message}`);
    // 如果序列化失败（例如因为循环引用），返回一个包含错误的JSON字符串
    return JSON.stringify({ error: `序列化后端返回结果时失败: ${e.message}` });
  }
}

function pingBackend() {
  return "Pong! Backend is alive at " + new Date().toLocaleTimeString();
}
