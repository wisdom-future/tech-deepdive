// 文件名: backend/ctrl.Code.gs

/**
 * @file 主控制器，处理Web应用入口和页面路由。
 * 这是建筑施工队和总设计师。它的职责是响应“建房”的请求，把房子的基本框架搭好。
 * 版本：3.19 - 恢复到推荐的 include() 模式，但 JS 已内联。
 */

/**
 * Web应用的主入口函数，处理所有页面请求。
 * @param {GoogleAppsScript.Events.DoGet} e - 事件对象，包含URL参数。
 * @returns {HtmlOutput} 渲染后的HTML页面。
 */
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


/**
 * 前端JS调用此函数，动态获取指定页面的HTML内容。
 * @param {string} pageName - 请求的页面名称。
 * @returns {string} 该页面的HTML内容。
 */
function getPageContent(pageName) {
  try {
    const templateName = CONFIG.PAGES[pageName] || 'pages/404.html';
    return HtmlService.createHtmlOutputFromFile(templateName).getContent();
  } catch (error) {
    Logger.log(`获取页面内容失败 [${pageName}]: ${error.message}`);
    return `<div class="error-container"><h2>错误</h2><p>无法加载页面: ${pageName}</p><p>详情: ${error.message}</p></div>`;
  }
}

/**
 * 在HTML模板中包含其他文件内容（CSS或JS）。
 * @param {string} filename - 要包含的文件路径。
 * @returns {string} 文件内容。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * 统一的API入口函数，供前端调用。
 * @param {string} serviceName - 要调用的服务名称。
 * @param {string} methodName - 要调用的方法名称。
 * @param {Array} args - 传递给方法的参数数组。
 * @returns {any} 方法的返回值。
 */
function callApi(serviceName, methodName, args = []) {
  Logger.log('*** DEBUG: callApi version 2025-06-29-v2 is active! ***'); 
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
  
  // 调试入口
  if (serviceName === 'debug' && methodName === 'ping') {
    return "Pong! Backend is alive at " + new Date().toLocaleTimeString();
  }

  // 【核心修正】确保 if...else 结构完整，覆盖所有可能性
  if (services[serviceName] && typeof services[serviceName][methodName] === 'function') {
    try {
      const result = services[serviceName][methodName](...(args || []));
      
      // 增加对 result 的最终检查，防止被调用的函数返回 null/undefined
      if (result === null || typeof result === 'undefined') {
        Logger.log(`警告: ${serviceName}.${methodName} 返回了 null 或 undefined。强制返回一个空对象{}.`);
        return {}; // 返回一个安全的空对象，避免前端报错
      }
      
      return result;

    } catch (e) {
      Logger.log(`执行 ${serviceName}.${methodName} 时捕获到严重错误: ${e.message} \n ${e.stack}`);
      return { 
        error: `在执行 ${serviceName}.${methodName} 时发生服务器内部错误: ${e.message}`
      };
    }
  } else {
    // 如果服务或方法未在白名单中，明确返回一个错误对象
    const errorMsg = `API call failed: Method '${methodName}' not found on service '${serviceName}'.`;
    Logger.log(errorMsg);
    return { error: errorMsg };
  }
}

/**
 * [DEBUG] 一个简单的后端函数，用于测试前后端通信。
 * @returns {string} 一个包含当前时间戳的字符串。
 */
function pingBackend() {
  return "Pong! Backend is alive at " + new Date().toLocaleTimeString();
}
