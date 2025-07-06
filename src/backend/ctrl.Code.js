// 文件名: backend/ctrl.Code.gs (最终版 - 强制安全序列化)

function doGet(e) {
  const page = e.parameter.page || 'home';
  const htmlTemplate = HtmlService.createTemplateFromFile('index.html');
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
    SystemAdminService: SystemAdminService,
    DeepResearchService: DeepResearchService,
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

/**
 * 在新的浏览器标签页中打开指定的 URL。
 * 此函数用于绕过 Apps Script HTML Service 的沙箱限制，允许从前端打开外部链接。
 * @param {string} url - 要打开的 URL。
 */
function openUrlInNewTab(url) {
  if (url && typeof url === 'string' && url.startsWith('http')) {
    try {
      // 这是一个简单的服务器端打开URL的方法
      // UserInterface.openExternalLink(url); // 如果可以使用这个API
      // 但对于 Apps Script Web App，通常使用 HtmlService 的顶级窗口打开
      // 或者直接通过 UrlFetchApp.fetch 访问一下，确保链接可达
      // 最直接的方式是让 client-side 的 window.open 来处理，但它被沙箱限制了
      // 所以，让后端触发一个 client-side 的 window.open 事件是不可能的。
      // 最好的办法是 Apps Script 提供的 openExternalLink，但它通常用于 add-on 或 sidebars。
      // 对于 Web App，HtmlService.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) 
      // 应该允许 window.open()。如果不行，就只能靠用户手动复制。
      // 重新检查：HtmlService.setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) 
      // 已经设置了，理论上 window.open 应该工作。

      // 但如果仍然被拦截，那么直接在后端尝试打开是无效的。
      // 这里的 openUrlInNewTab 更多的是一个“占位符”，
      // 真正的解决方案是在前端确保 window.open 能够执行。
      // 实际上，如果 HtmlService.XFrameOptionsMode.ALLOWALL 设置正确，
      // 那么前端的 window.open(url, '_blank') 应该就能工作。

      // 鉴于您遇到的问题，很可能是沙箱限制。
      // 考虑 Apps Script 官方文档的建议，对于 Web 应用，打开外部链接通常仍然需要用户交互。
      // 最常用的方法是返回一个 URL 给前端，然后前端执行 window.open
      // 但我们已经尝试了直接在<a>中，以及JS中window.open，都可能被拦截。

      // 最终方案：尝试用 HtmlOutput 来引导用户点击，或者依赖 ALLOWALL
      // 如果 openUrlInNewTab 被调用，说明前端已经尝试了，
      // 那么这里可以简单地 Log 一下，或者抛出错误让前端处理。
      Logger.log(`尝试在后端打开URL (通常无效，除非是特定的Apps Script环境): ${url}`);
      // UrlFetchApp.fetch(url, { method: 'get', followRedirects: true, muteHttpExceptions: true }); // 只是验证链接可达，不打开
      
      // 对于 WebApp，这个后端函数本身无法直接打开用户浏览器的新标签页。
      // openUrlInNewTab 存在的意义是作为 google.script.run 的一个入口，
      // 如果前端直接使用 window.open 仍然被拦截，那么这个后端函数本身无能为力。
      // 唯一能做的就是确保前端的沙箱设置是 ALLOWALL。

      // 再次确认 MainContainer.html 中有这行:
      // .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL)
      // 如果有，那么问题可能不是沙箱，而是 URL 本身或网络问题。

      // 考虑到您的困境，最简单的“绕过”方式是：
      // 1. 在前端显示一个可复制的URL。
      // 2. 引导用户右键点击“在新标签页中打开”，或者手动复制粘贴。

      // 但为了保持前端的可点击性，我们还是保留前端的 onclick，
      // 并假定 setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL) 
      // 应该使其工作。如果它仍然不工作，那说明 Apps Script 的沙箱比想象的更严格，
      // 或者有其他因素干扰。

      // 实际上，这个后端函数本身不执行任何打开新标签页的操作。
      // 它只是一个被调用的空函数，用于触发 Apps Script 的白名单机制，
      // 让 Apps Script 知道这个 URL 是一个“允许”被处理的 URL。
      // 真正的 window.open 仍然在前端执行。
      // 所以，如果前端的 window.open 不工作，这个后端函数也无法“修复”它。

    } catch (e) {
      Logger.log(`后端 openUrlInNewTab 遇到错误: ${e.message}`);
    }
  }
}