// ==================================================================================================
//  【最终完整版 v43.0】CollectionStatsService - 彻底解决所有Date序列化问题
// ==================================================================================================

/** @global CONFIG */
/** @global DataService */
/** @global DateUtils */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

function computeCollectionStats() {
  const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
  const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;
  const logs = DataService.getDataAsObjects(dbId, sheetName) || []; // 确保即使DataService返回null也至少是空数组

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;

  // Using DateUtils for parsing dates
  const parseDate = (str) => DateUtils.parseDate(str);

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
    return DateUtils.formatDatesInObjectsArray(dataArray); // Use centralized DateUtils
  },

  getAcademicPapersDetails() {
    const dbId = CONFIG.DATABASE_IDS.RAWDATA_DB;
    const sheetName = CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS;
    const rows = DataService.getDataAsObjects(dbId, sheetName);

    return rows.map(r => ({
      TITLE: r.title || '',
      AUTHORS: r.authors || '',
      PUBLICATION_DATE: DateUtils.formatDate(r.publication_date), // Use DateUtils
      PROCESSING_STATUS: r.processing_status || '',
      SOURCE_URL: r.source_url || ''
    }));
  },

  getCollectionStats: function() {
    try {
      return computeCollectionStats();
    } catch (e) {
      logError('[CollectionStatsService] getCollectionStats error: ' + e.message);
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

    // Step 1: 解析日期并准备用于排序
    const processedLogs = rawLogs.map(log => {
      // Attempt to parse all possible timestamp fields into Date objects
      const startTsObj = DateUtils.parseDate(log.start_timestamp);
      const endTsObj = DateUtils.parseDate(log.end_timestamp);
      const createdTsObj = DateUtils.parseDate(log.created_timestamp);

      // Collect all valid date objects
      const validDates = [];
      if (startTsObj && !isNaN(startTsObj.getTime())) validDates.push(startTsObj);
      if (endTsObj && !isNaN(endTsObj.getTime())) validDates.push(endTsObj);
      if (createdTsObj && !isNaN(createdTsObj.getTime())) validDates.push(createdTsObj);

      // Determine the date for sorting: pick the latest among all valid dates
      let sortableDate = new Date(0); // Default to a very early date
      if (validDates.length > 0) {
          sortableDate = validDates.reduce((latest, current) =>
              current.getTime() > latest.getTime() ? current : latest,
              new Date(0) // Initial value also set to epoch time
          );
      }

      return {
        sortableDate: sortableDate, // Date object for sorting
        execution_id: log.execution_id || log.Execution_ID || null, // Ensure execution_id is available
        workflow_name: log.workflow_name || '未命名工作流',
        start_timestamp: DateUtils.formatDate(log.start_timestamp, true), // Format for display
        end_timestamp: DateUtils.formatDate(log.end_timestamp, false),   // Format for display
        execution_status: log.execution_status || '未知'
      };
    });

    // Core: Sort in descending order by sortableDate (newest on top)
    processedLogs.sort((a, b) => b.sortableDate.getTime() - a.sortableDate.getTime());

    // Truncate to the latest 'limit' records
    const latestLogs = processedLogs.slice(0, limit);

    return latestLogs;
  },

  getWorkflowExecutionDetail: function(executionId) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;
    const rows = DataService.getDataAsObjects(dbId, sheetName) || [];
    const row = rows.find(row => {
      if (row.execution_id == null || executionId == null) {
        return false;
      }
      return String(row.execution_id).trim() === String(executionId).trim();
    });
    if (!row) {
      return { error: "未找到该执行记录", execution_id: executionId };
    }
    // Convert all Date objects to ISO strings using DateUtils
    const detail = {};
    for (var k in row) {
      if (row[k] instanceof Date) {
        detail[k] = DateUtils.formatDate(row[k], true); // Use DateUtils to format dates
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
      const todayStr = DateUtils.formatDate(new Date()); // Use DateUtils

      logDebug("DEBUG: getCollectionPageData - 开始获取技术类数据源...");
      // 1. 获取并处理技术类数据源
      pageData.techData = {
        academicPapers: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS),
        patentData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA),
        openSourceData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA),
        techNews: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS)
      };
      // 检查techData是否正常，并格式化日期
      for (const key in pageData.techData) {
        if (pageData.techData[key] === null || typeof pageData.techData[key] === 'undefined') {
            throw new Error(`DataService returned null/undefined for techData.${key}. Check sheet name or ID.`);
        }

        if (pageData.techData[key].length > 0) {
            const ingestionDateField = ingestionDateFieldMap[key] || 'created_timestamp'; // 确保这里使用了正确的映射
            logDebug(`DEBUG: Checking todayCount for ${key}. TodayStr: ${todayStr}. Sample ingestion dates (first 5):`);
            pageData.techData[key].slice(0, 5).forEach((item, idx) => {
                const dateVal = item[ingestionDateField];
                logDebug(`  [${idx}] ${ingestionDateField}: ${dateVal} (sliced: ${String(dateVal || '').slice(0, 10)})`);
            });
        }

        pageData.techData[key] = this._formatDatesInArray(pageData.techData[key]);

      // **新增调试日志：打印 _formatDatesInArray 处理后的 created_timestamp 值**
      if (CONFIG.LOG_LEVEL === 'DEBUG' && pageData.techData.techNews && pageData.techData.techNews.length > 0) {
          logDebug(`DEBUG_FORMATTED_DATES: TodayStr: ${todayStr}`);
          logDebug(`DEBUG_FORMATTED_DATES: First 5 records of techNews AFTER _formatDatesInArray:`);
          pageData.techData.techNews.slice(0, 5).forEach((item, idx) => {
              const createdTsVal = item.created_timestamp;
              logDebug(`  [${idx}] created_timestamp: '${createdTsVal}' (Type: ${typeof createdTsVal})`);
              logDebug(`  [${idx}] Sliced: '${String(createdTsVal || '').slice(0, 10)}'`);
              logDebug(`  [${idx}] Match with TodayStr: ${String(createdTsVal || '').slice(0, 10) === todayStr}`);
          });
      }
      // **调试日志结束**

        logDebug(`DEBUG:   - techData.${key} fetched: ${pageData.techData[key].length} records.`);
      }

      logDebug("DEBUG: getCollectionPageData - 开始获取标杆类数据源...");
      // 2. 获取并处理标杆类数据源
      pageData.benchmarkData = {
        industryDynamics: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS),
        competitorIntelligence: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE)
      };
      // 检查benchmarkData是否正常，并格式化日期
      for (const key in pageData.benchmarkData) {
        if (pageData.benchmarkData[key] === null || typeof pageData.benchmarkData[key] === 'undefined') {
            throw new Error(`DataService returned null/undefined for benchmarkData.${key}. Check sheet name or ID.`);
        }
        pageData.benchmarkData[key] = this._formatDatesInArray(pageData.benchmarkData[key]);
        logDebug(`DEBUG:   - benchmarkData.${key} fetched: ${pageData.benchmarkData[key].length} records.`);
      }

      logDebug("DEBUG: getCollectionPageData - 开始获取配置信息 (competitors)...");
      // 3. 获取配置信息 (通常不含日期，无需处理)
      const rawCompetitors = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.COMPETITOR_REGISTRY);
      if (rawCompetitors === null || typeof rawCompetitors === 'undefined') {
          throw new Error(`DataService returned null/undefined for competitors. Check sheet name or ID.`);
      }
      pageData.competitors = rawCompetitors.map(c => ({ id: c.competitor_id, name: c.company_name }));
      logDebug(`DEBUG:   - competitors fetched: ${pageData.competitors.length} records.`);
      
      logDebug("DEBUG: getCollectionPageData - 开始获取历史记录 (workflow logs)...");
      // 4. 获取所有工作流日志，然后由 _formatHistoryLogs 进行排序和截取
      const historyLogsRaw = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.OPERATIONS_DB, CONFIG.SHEET_NAMES.WORKFLOW_LOG);
      if (historyLogsRaw === null || typeof historyLogsRaw === 'undefined') {
          throw new Error(`DataService returned null/undefined for historyLogsRaw. Check sheet name or ID.`);
      }
      pageData.history = this._formatHistoryLogs(historyLogsRaw); // _formatHistoryLogs 内部已经处理了排序和截取
      logDebug(`DEBUG:   - history fetched: ${pageData.history.length} records (after format and slice).`);

      logDebug("DEBUG: getCollectionPageData - 开始获取采集统计数据...");
      // 5. 获取统计数据
      pageData.overallStats = computeCollectionStats();
      if (pageData.overallStats === null || typeof pageData.overallStats === 'undefined') {
          throw new Error(`computeCollectionStats returned null/undefined.`);
      }
      logDebug(`DEBUG:   - overallStats fetched: OK.`);

      logDebug("DEBUG: getCollectionPageData - 所有数据获取完成，准备返回 pageData。");
      // 核心：在返回之前将 pageData 序列化为 JSON 字符串
      return JSON.stringify(pageData); 

    } catch(e) {
      logError(`ERROR in getCollectionPageData: ${e.message} \n ${e.stack}`);
      // 即使在错误情况下，也返回一个可解析的JSON字符串，包含错误信息
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
  logInfo("--- 开始测试 Collection History 数据流 ---");
  try {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.WORKFLOW_LOG;

    logInfo(`1. 尝试从 DB: ${dbId}, Sheet: ${sheetName} 获取所有原始日志数据...`);

    const rawLogs = DataService.getDataAsObjects(dbId, sheetName);

    if (!rawLogs || rawLogs.length === 0) {
      logError("❌ 错误: 未获取到任何原始日志数据，或数据为空。请检查 Google Sheet 是否有数据。");
      return;
    }

    logInfo(`✅ 成功获取 ${rawLogs.length} 条原始日志数据。`);

    // 调用 CollectionStatsService._formatHistoryLogs 进行排序和截取
    // 传入一个较大的 limit (例如 20)，以便观察排序效果
    const testLimit = 20; 
    logInfo(`\n2. 调用 CollectionStatsService._formatHistoryLogs 函数，获取最新的 ${testLimit} 条日志 (应按最新日期倒序):`); // **修改日志说明**
    const formattedAndSortedLogs = CollectionStatsService._formatHistoryLogs(rawLogs, testLimit); 

    if (formattedAndSortedLogs.length > 0) {
      // **修改点2：直接打印格式化并排序后的结果**
      formattedAndSortedLogs.forEach((log, index) => {
        logInfo(`  [${index}] workflow_name: ${log.workflow_name || 'N/A'}, ` +
                   `status: ${log.execution_status || 'N/A'}, ` +
                   `start_timestamp: ${log.start_timestamp || 'N/A'}, ` +
                   `end_timestamp: ${log.end_timestamp || 'N/A'}, ` +
                   `sortableDate: ${log.sortableDate ? log.sortableDate.toISOString() : 'N/A'}`);
      });
      logInfo(`\n✅ 格式化并排序后的日志数据已打印。请检查日期是否按倒序排列，并且最新数据是否在顶部。`);
    } else {
      logError("❌ 错误: 格式化后的日志数据为空。");
    }

  } catch (e) {
    logError(`❌ 测试 Collection History 数据流失败: ${e.message}\n${e.stack}`);
  }
  logInfo("--- 结束测试 Collection History 数据流 ---");
}