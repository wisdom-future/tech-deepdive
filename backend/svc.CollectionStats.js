// =======================================================================
//  【最终完整版 v43.0】CollectionStatsService - 彻底解决所有Date序列化问题
// =======================================================================
function computeCollectionStats() {
  const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
  const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;
  const logs = DataService.getDataAsObjects(dbId, sheetName) || []; // 确保即使DataService返回null也至少是空数组

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;

  function parseDate(str) {
    if (!str) return null;
    str = String(str);
    if (str.includes('T')) return new Date(str);
    // 尝试处理常见的日期格式，避免时区问题
    return new Date(str.replace(/-/g, '/')); 
  }

  const thisMonthLogs = logs.filter(log => {
    const d = parseDate(log.start_timestamp || log.created_timestamp);
    return d && d.getFullYear() === year && (d.getMonth() + 1) === month;
  });
  const lastMonthLogs = logs.filter(log => {
    const d = parseDate(log.start_timestamp || log.created_timestamp);
    return d && d.getFullYear() === lastMonthYear && (d.getMonth() + 1) === lastMonth;
  });

  const thisTotal = thisMonthLogs.length;
  const lastTotal = lastMonthLogs.length;
  const thisSuccess = thisMonthLogs.filter(log => String(log.execution_status).toLowerCase() === 'completed').length;
  const lastSuccess = lastMonthLogs.filter(log => String(log.execution_status).toLowerCase() === 'completed').length;
  const thisFailed = thisMonthLogs.filter(log => String(log.execution_status).toLowerCase() === 'failed').length;
  const lastFailed = lastMonthLogs.filter(log => String(log.execution_status).toLowerCase() === 'failed').length;
  const thisSuccessRate = thisTotal > 0 ? Math.round(thisSuccess / thisTotal * 1000) / 10 : 0;
  const lastSuccessRate = lastTotal > 0 ? Math.round(lastSuccess / lastTotal * 1000) / 10 : 0;
  const monthlyChange = lastTotal === 0 ? 0 : Math.round(((thisTotal - lastTotal) / lastTotal) * 1000) / 10;
  const successRateChange = lastSuccessRate === 0 ? 0 : Math.round((thisSuccessRate - lastSuccessRate) * 10) / 10;
  const failedTasksChange = thisFailed - lastFailed;

  return {
    monthlyVolume: thisTotal,
    monthlyChange: monthlyChange,
    successRate: thisSuccessRate,
    successRateChange: successRateChange,
    failedTasks: thisFailed,
    failedTasksChange: failedTasksChange
  };
}


const CollectionStatsService = {
  
  /**
   * 辅助函数：安全地将任何值中的Date对象转换为 "YYYY-MM-DD" 格式的字符串。
   * @param {Array<Object>} dataArray - 从DataService获取的对象数组。
   * @returns {Array<Object>} - 处理完日期后的新数组。
   */
  _formatDatesInArray: function(dataArray) {
    if (!Array.isArray(dataArray)) return [];
    
    return dataArray.map(row => {
      const newRow = {};
      for (const key in row) {
        if (row[key] instanceof Date) {
          // 使用 toISOString() 获取 UTC 标准格式 "YYYY-MM-DDTHH:mm:ss.sssZ"
          // 然后用 split('T')[0] 精确地截取日期部分
          newRow[key] = row[key].toISOString().split('T')[0];
        } else {
          newRow[key] = row[key];
        }
      }
      return newRow;
    });
  },

  getAcademicPapersDetails() {
    // 替换为你的实际 RAWDATA_DB 和 SHEET_NAMES
    const dbId = CONFIG.DATABASE_IDS.RAWDATA_DB;
    const sheetName = CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS;
    const rows = DataService.getDataAsObjects(dbId, sheetName);

    return rows.map(r => ({
      TITLE: r.title || '',
      AUTHORS: r.authors || '',
      PUBLICATION_DATE: r.publication_date || '',
      PROCESSING_STATUS: r.processing_status || '',
      SOURCE_URL: r.source_url || ''
    }));
  },

  getCollectionStats: function() {
    try {
      return computeCollectionStats();
    } catch (e) {
      Logger.log('getCollectionStats error: ' + e.message);
      return {
        monthlyVolume: 0,
        monthlyChange: 0,
        successRate: 0,
        successRateChange: 0,
        failedTasks: 0,
        failedTasksChange: 0,
        error: e.message
      };
    }
  },

  /**
   * 辅助函数：格式化历史日志数据，并进行排序和截取。
   * @param {Array<Object>} rawLogs - 原始的日志记录数组。
   * @param {number} limit - 要返回的最新记录数量（默认为10）。
   * @returns {Array<Object>} - 格式化、排序并截取后的日志记录数组。
   */
  _formatHistoryLogs: function(rawLogs, limit = 10) { // 默认显示最近10条
    if (!Array.isArray(rawLogs)) {
      return [];
    }

    // 辅助函数：用于统一格式化日期，处理N/A或无效日期
    const formatForDisplay = (dateValue, includeTime = false) => {
      if (!dateValue) return 'N/A';
      let dateObj;
      if (dateValue instanceof Date) {
        dateObj = dateValue;
      } else {
        // 尝试解析字符串日期，处理可能的ISO格式或纯日期格式
        dateObj = new Date(dateValue);
      }
      if (isNaN(dateObj.getTime())) return 'N/A'; // 处理无效日期字符串

      const format = includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd';
      return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
    };

    // Step 1: 解析日期并准备用于排序
    const processedLogs = rawLogs.map(log => {
      // 尝试解析所有可能的时间戳字段为Date对象
      const startTsObj = log.start_timestamp ? new Date(log.start_timestamp) : null;
      const endTsObj = log.end_timestamp ? new Date(log.end_timestamp) : null;
      const createdTsObj = log.created_timestamp ? new Date(log.created_timestamp) : null;

      // 收集所有有效的日期对象
      const validDates = [];
      if (startTsObj && !isNaN(startTsObj.getTime())) validDates.push(startTsObj);
      if (endTsObj && !isNaN(endTsObj.getTime())) validDates.push(endTsObj);
      if (createdTsObj && !isNaN(createdTsObj.getTime())) validDates.push(createdTsObj);

      // 确定用于排序的日期：选取所有有效日期中最新的一个
      let sortableDate = new Date(0); // 默认一个非常早的日期
      if (validDates.length > 0) {
          sortableDate = validDates.reduce((latest, current) =>
              current.getTime() > latest.getTime() ? current : latest,
              new Date(0) // 初始值也设为epoch time
          );
      }

      return {
        sortableDate: sortableDate, // 用于排序的Date对象
        execution_id: log.execution_id || log.Execution_ID || null, // 确保 execution_id 可用
        workflow_name: log.workflow_name || '未命名工作流',
        start_timestamp: formatForDisplay(log.start_timestamp, true), // 格式化为显示字符串
        end_timestamp: formatForDisplay(log.end_timestamp, false),   // 格式化为显示字符串
        execution_status: log.execution_status || '未知'
      };
    });

    // 核心：按 sortableDate 进行倒序排序 (最新的在最上面)
    processedLogs.sort((a, b) => b.sortableDate.getTime() - a.sortableDate.getTime());

    // 截取最新的 'limit' 条记录
    const latestLogs = processedLogs.slice(0, limit);

    return latestLogs;
  },

  getWorkflowExecutionDetail: function(executionId) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;
    const rows = DataService.getDataAsObjects(dbId, sheetName) || [];
    const row = rows.find(row => {
      // 增加一个安全检查，防止 row.execution_id 本身为 null 或 undefined
      if (row.execution_id == null || executionId == null) {
        return false;
      }
      // 使用非严格等于 (==) 来比较，它会自动处理数字和字符串之间的类型转换。
      // 同时对两边都进行 trim()，去除可能存在的前后空格。
      return String(row.execution_id).trim() == String(executionId).trim();
    });
    if (!row) {
      return { error: "未找到该执行记录", execution_id: executionId };
    }
    // 把所有 Date 转换为字符串
    const detail = {};
    for (var k in row) {
      if (row[k] instanceof Date) {
        detail[k] = row[k].toISOString();
      } else {
        detail[k] = row[k];
      }
    }
    return detail;
  },

  /**
   * 一次性获取“数据采集”页面所需的所有原始数据，并确保所有日期都已格式化。
   * @returns {string} 包含所有页面数据的JSON字符串。
   */
  getCollectionPageData: function() {
    try {
      const pageData = {};
      // **修正点 1：将 ingestionDateFieldMap 的定义移到函数顶部**
      // ！！！重要：请根据您的实际 Google Sheet 原始数据表来确认这个字段名。
      // 通常这个字段名为 'created_timestamp' 或 'processed_timestamp'。
      // 如果您的 Sheet 中是其他名称，请修改这里的映射。
      const ingestionDateFieldMap = {
          academicPapers: 'created_timestamp', 
          patentData: 'created_timestamp',     
          openSourceData: 'created_timestamp', 
          techNews: 'created_timestamp',       
          industryDynamics: 'created_timestamp', 
          techInnovation: 'created_timestamp', 
          productRelease: 'created_timestamp', 
          talentFlow: 'created_timestamp' 
      };
      // **修正点 2：将 todayStr 的定义移到函数顶部，在所有循环之外**
      const todayStr = new Date().toISOString().slice(0, 10); // 获取当前日期的 YYYY-MM-DD 字符串

      Logger.log("DEBUG: getCollectionPageData - 开始获取技术类数据源...");
      pageData.techData = {
        academicPapers: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS)),
        patentData: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA)),
        openSourceData: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA)),
        techNews: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS))
      };
      Logger.log(`DEBUG:   - 技术类数据已获取并格式化完毕。`);

      Logger.log("DEBUG: getCollectionPageData - 开始获取标杆类数据源...");
      pageData.benchmarkData = {
        industryDynamics: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS)),
        competitorIntelligence: this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE))
      };
      Logger.log(`DEBUG:   - 标杆类数据已获取并格式化完毕。`);

      Logger.log("DEBUG: getCollectionPageData - 开始获取配置信息 (competitors)...");
      const rawCompetitors = this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.COMPETITOR_REGISTRY));
      if (rawCompetitors === null || typeof rawCompetitors === 'undefined') {
          throw new Error(`DataService returned null/undefined for competitors. Check sheet name or ID.`);
      }
      pageData.competitors = rawCompetitors.map(c => ({ id: c.competitor_id, name: c.company_name }));
      Logger.log(`DEBUG:   - competitors fetched: ${pageData.competitors.length} records.`);
      
      Logger.log("DEBUG: getCollectionPageData - 开始获取历史记录 (workflow logs)...");
      const historyLogsRaw = this._formatDatesInArray(DataService.getDataAsObjects(CONFIG.DATABASE_IDS.OPERATIONS_DB, CONFIG.SHEET_NAMES.WORKFLOW_LOG));
      if (historyLogsRaw === null || typeof historyLogsRaw === 'undefined') {
          throw new Error(`DataService returned null/undefined for historyLogsRaw. Check sheet name or ID.`);
      }
      pageData.history = this._formatHistoryLogs(historyLogsRaw);
      Logger.log(`DEBUG:   - history fetched: ${pageData.history.length} records (after format and slice).`);

      Logger.log("DEBUG: getCollectionPageData - 开始获取采集统计数据...");
      pageData.overallStats = computeCollectionStats();
      if (pageData.overallStats === null || typeof pageData.overallStats === 'undefined') {
          throw new Error(`computeCollectionStats returned null/undefined.`);
      }
      Logger.log(`DEBUG:   - overallStats fetched: OK.`);

      Logger.log("DEBUG: getCollectionPageData - 所有数据获取完成，准备返回 pageData。");
      return JSON.stringify(pageData); 

    } catch(e) {
      Logger.log(`ERROR in getCollectionPageData: ${e.message} \n ${e.stack}`);
      return JSON.stringify({ error: `获取采集页数据时发生服务器内部错误: ${e.message}. 请检查Apps Script日志获取更多详情。` });
    }
  }
};

/**
 * @file 用于测试数据流的辅助函数。
 */

/**
 * 测试“最近采集历史”的数据获取和处理流程。
 * 旨在诊断为何前端未能显示最新数据。
 */
function test_CollectionHistoryDataFlow() {
  Logger.log("--- 开始测试 Collection History 数据流 ---");
  try {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;

    Logger.log(`1. 尝试从 DB: ${dbId}, Sheet: ${sheetName} 获取所有原始日志数据...`);

    const rawLogs = DataService.getDataAsObjects(dbId, sheetName);

    if (!rawLogs || rawLogs.length === 0) {
      Logger.log("❌ 错误: 未获取到任何原始日志数据，或数据为空。请检查 Google Sheet 是否有数据。");
      return;
    }

    Logger.log(`✅ 成功获取 ${rawLogs.length} 条原始日志数据。`);

    // **修改点1：不再打印原始日志的最后5条，因为 _formatHistoryLogs 会处理排序**
    // Logger.log("2. 原始日志数据示例 (从 DataService 获取，按Sheet原始顺序，打印最后5条):");
    // rawLogs.slice(-5).forEach((log, index) => { // 打印最后5条，因为新数据通常在底部
    //   Logger.log(`  [${rawLogs.length - 5 + index}] workflow_name: ${log.workflow_name || 'N/A'}, ` +
    //              `execution_status: ${log.execution_status || 'N/A'}, ` +
    //              `start_timestamp: ${log.start_timestamp || 'N/A'}, ` +
    //              `end_timestamp: ${log.end_timestamp || 'N/A'}`);
    // });

    // 调用 CollectionStatsService._formatHistoryLogs 进行排序和截取
    // 传入一个较大的 limit (例如 20)，以便观察排序效果
    const testLimit = 20; 
    Logger.log(`\n2. 调用 CollectionStatsService._formatHistoryLogs 函数，获取最新的 ${testLimit} 条日志 (应按最新日期倒序):`); // **修改日志说明**
    const formattedAndSortedLogs = CollectionStatsService._formatHistoryLogs(rawLogs, testLimit); 

    if (formattedAndSortedLogs.length > 0) {
      // **修改点2：直接打印格式化并排序后的结果**
      formattedAndSortedLogs.forEach((log, index) => {
        Logger.log(`  [${index}] workflow_name: ${log.workflow_name || 'N/A'}, ` +
                   `status: ${log.execution_status || 'N/A'}, ` +
                   `start_timestamp: ${log.start_timestamp || 'N/A'}, ` +
                   `end_timestamp: ${log.end_timestamp || 'N/A'}, ` +
                   `sortableDate: ${log.sortableDate ? log.sortableDate.toISOString() : 'N/A'}`);
      });
      Logger.log(`\n✅ 格式化并排序后的日志数据已打印。请检查日期是否按倒序排列，并且最新数据是否在顶部。`);
    } else {
      Logger.log("❌ 错误: 格式化后的日志数据为空。");
    }

  } catch (e) {
    Logger.log(`❌ 测试 Collection History 数据流失败: ${e.message}\n${e.stack}`);
  }
  Logger.log("--- 结束测试 Collection History 数据流 ---");
}
