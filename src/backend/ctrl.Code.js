/**
 * @file ctrl.Code.js
 * @description Web App 主入口与API网关。
 * 负责处理所有HTTP请求，并作为所有前端API调用的统一安全网关。
 * 
 * @version 2.0 (Corrected for async/await)
 * @changelog
 *   - [CRITICAL FIX] `callApi` function is now `async` and uses `await` when invoking service methods. This resolves the issue where the gateway would return an empty object `{}` for async services by correctly waiting for the Promise to resolve before serializing the result.
 */

/**
 * 处理GET请求，渲染主HTML模板。
 * @param {object} e - Apps Script的事件对象。
 * @returns {HtmlOutput}
 */
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

/**
 * 在HTML模板中包含其他HTML文件。
 * @param {string} filename - 要包含的文件路径。
 * @returns {string} 文件内容。
 */
function include(filename) {
  return HtmlService.createHtmlOutputFromFile(filename).getContent();
}

/**
 * API总网关，由前端通过 google.script.run 调用。
 * @param {string} serviceName - 要调用的服务名称 (e.g., 'DashboardService').
 * @param {string} methodName - 要调用的方法名称 (e.g., 'getDashboardData').
 * @param {Array} args - 传递给方法的参数数组。
 * @returns {string} JSON格式的响应字符串。
 */
// ✅ [修正] 将函数声明为 async，以支持 await
async function callApi(serviceName, methodName, args = []) {
  Logger.log(`[API Gateway] Invoked: ${serviceName}.${methodName} with args: ${JSON.stringify(args)}`);

  // --- 1. 认证与权限检查 (Authentication & Authorization) ---
  let authInfo;
  try {
    // AuthService 来自 layer05.AuthService.js
    authInfo = AuthService.authenticateUser();
    if (authInfo && authInfo.error === 'LOGIN_REQUIRED') {
      return JSON.stringify(authInfo);
    }
    Logger.log(`[API Gateway] User Authenticated: ${authInfo.user_email} (Role: ${authInfo.role_id})`);
  } catch (e) {
    Logger.log(`[API Gateway] Authentication failed: ${e.message}`);
    return JSON.stringify({ error: `认证失败: ${e.message}` });
  }

  // ✅ [重构] 定义新的、对齐后架构的服务路由表
  // 这个路由表是“前台同步执行泳道”的核心
  const services = {
    // Layer 04: API Services
    AnalysisService: AnalysisService,
    CopilotService: CopilotService,
    DashboardService: DashboardService,
    ExplorationService: ExplorationService,
    FindingsService: FindingsService,
    RegistryService: RegistryService, // 新的注册表服务
    SystemHealthStatsService: SystemHealthStatsService,
    TechnologyHistoryService: TechnologyHistoryService,
    
    // Layer 05: Auth Service
    AuthService: AuthService
    
    // 注意：RawDataStatsService, ConfigDataService, SystemAdminService 已被解散
    // DataProcessService (瘦身后的ProcessingService) 是后台服务，不应通过此API网关直接调用
  };

  // --- 2. 模块级权限检查 ---
  const moduleName = serviceName.replace('Service', '').toLowerCase();
  // AuthService 本身不需要权限检查
  if (serviceName !== 'AuthService') {
    if (!authInfo || !authInfo.permissions || !AuthService.getModuleAccess(moduleName, authInfo.permissions)) {
      Logger.log(`[API Gateway] User ${authInfo.user_email} DENIED access to module: ${moduleName}`);
      return JSON.stringify({ error: `无权限访问模块：${moduleName}` });
    }
  }
  
  // --- 3. 服务路由与安全执行 ---
  let result;
  const service = services[serviceName];

  if (service && typeof service[methodName] === 'function') {
    try {
      Logger.log(`[API Gateway] Routing to ${serviceName}.${methodName}`);
      // ✅ [增强] 将 authInfo 作为第一个参数注入，让每个API方法都能感知用户上下文
      // ✅ [修正] 使用 await 等待异步方法执行完成
      result = await service[methodName](authInfo, ...(args || []));
    } catch (e) {
      Logger.log(`[API Gateway] Execution ERROR in ${serviceName}.${methodName}: ${e.message}\n${e.stack}`);
      result = { error: `服务器内部错误: ${e.message}` };
    }
  } else {
    Logger.log(`[API Gateway] API Not Found: Method '${methodName}' on service '${serviceName}'.`);
    result = { error: `API调用失败: 未找到方法 '${methodName}' on service '${serviceName}'.` };
  }
  
  // --- 4. 统一返回与安全序列化 ---
  try {
    return JSON.stringify(result);
  } catch (e) {
    Logger.log(`[API Gateway] CRITICAL: Serialization failed for ${serviceName}.${methodName} result. Error: ${e.message}`);
    // 返回一个安全的错误对象，以防序列化循环引用等问题
    return JSON.stringify({ 
      error: `序列化后端返回结果时失败: ${e.message}`,
      error_details: 'The server returned data that could not be converted to a string. This might be due to circular references or unsupported data types.'
    });
  }
}

/**
 * [保持] 绕过沙箱限制，用于从前端打开外部链接。
 * @param {string} url - 要打开的 URL。
 */
function openUrlInNewTab(url) {
  // 此函数的逻辑保持不变，它主要作为前端google.script.run的一个可信入口。
  if (url && typeof url === 'string' && url.startsWith('http')) {
    Logger.log(`[Helper] openUrlInNewTab invoked for URL: ${url}. This is a placeholder for client-side action.`);
    // 后端无实际操作，依赖前端的 window.open
  } else {
    Logger.log(`[Helper] openUrlInNewTab received an invalid URL: ${url}`);
  }
}
