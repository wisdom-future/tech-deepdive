// 文件名: backend/svc.CollectionStats.gs (最终诊断增强版 - 基于你的代码)

/**
 * @file 数据采集页面相关服务
 * @version 44.0 - 完全适配 Firestore
 */

// 将这个辅助函数移到全局作用域，以便 service 内部可以调用
function computeCollectionStats() {
  // ✅ 从 Firestore 读取 WORKFLOW_LOG
  const logs = DataService.getDataAsObjects('WORKFLOW_LOG') || [];

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const lastMonth = month === 1 ? 12 : month - 1;
  const lastMonthYear = month === 1 ? year - 1 : year;

  function parseDate(str) {
    if (!str) return null;
    return new Date(str); // Firestore 返回的 ISO 字符串或 Date 对象可以直接解析
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
   * ✅ 最终修正: 确保返回的数据结构总是完整的
   * ✅ 诊断增强: 增加了详细的日志来追踪数据获取过程。
   */
  getCollectionPageData: function() {
    // ======================= 诊断日志开始 =======================
    Logger.log("=========================================================");
    Logger.log("--- [DIAGNOSIS] getCollectionPageData 开始执行 ---");
    Logger.log(`--- 执行时间: ${new Date().toISOString()} ---`);
    Logger.log("=========================================================");
    // ==========================================================

    try {
      const pageData = {
        techData: {
          academicPapers: [],
          patentData: [],
          openSourceData: [],
          techNews: []
        },
        benchmarkData: {
          industryDynamics: [],
          competitorIntelligence: []
        },
        competitors: [],
        history: [],
        overallStats: {}
      };

      // 辅助函数，用于包装数据获取并添加日志
      const logAndGetData = (key) => {
        try {
          const data = DataService.getDataAsObjects(key);
          // ======================= 诊断日志 =======================
          Logger.log(`[DIAGNOSIS] 从 Firestore 集合 '${key}' 读取了 ${data ? data.length : 0} 条记录。`);
          // ======================================================
          return data || [];
        } catch (e) {
          Logger.log(`[DIAGNOSIS] ❌ 读取集合 '${key}' 时发生错误: ${e.message}`);
          return [];
        }
      };

      // 使用 try-catch 包裹每一个数据获取，防止一个失败导致全部失败
      try { pageData.techData.academicPapers = logAndGetData('RAW_ACADEMIC_PAPERS'); } catch (e) { Logger.log(`获取 RAW_ACADEMIC_PAPERS 失败: ${e.message}`); }
      try { pageData.techData.patentData = logAndGetData('RAW_PATENT_DATA'); } catch (e) { Logger.log(`获取 RAW_PATENT_DATA 失败: ${e.message}`); }
      try { pageData.techData.openSourceData = logAndGetData('RAW_OPENSOURCE_DATA'); } catch (e) { Logger.log(`获取 RAW_OPENSOURCE_DATA 失败: ${e.message}`); }
      try { pageData.techData.techNews = logAndGetData('RAW_TECH_NEWS'); } catch (e) { Logger.log(`获取 RAW_TECH_NEWS 失败: ${e.message}`); }
      
      try { pageData.benchmarkData.industryDynamics = logAndGetData('RAW_INDUSTRY_DYNAMICS'); } catch (e) { Logger.log(`获取 RAW_INDUSTRY_DYNAMICS 失败: ${e.message}`); }
      try { pageData.benchmarkData.competitorIntelligence = logAndGetData('RAW_COMPETITOR_INTELLIGENCE'); } catch (e) { Logger.log(`获取 RAW_COMPETITOR_INTELLIGENCE 失败: ${e.message}`); }

      try { pageData.competitors = logAndGetData('COMPETITOR_REGISTRY').map(c => ({ id: c.competitor_id, name: c.company_name })); } catch (e) { Logger.log(`获取 COMPETITOR_REGISTRY 失败: ${e.message}`); }
      
      try { pageData.history = this._formatHistoryLogs(logAndGetData('WORKFLOW_LOG')); } catch (e) { Logger.log(`获取 WORKFLOW_LOG 失败: ${e.message}`); }
      
      try { 
        Logger.log("[DIAGNOSIS] 正在计算 overallStats...");
        pageData.overallStats = computeCollectionStats(); 
        Logger.log(`[DIAGNOSIS] overallStats 计算完成: ${JSON.stringify(pageData.overallStats)}`);
      } catch (e) { 
        Logger.log(`计算 overallStats 失败: ${e.message}`); 
      }
      
      Logger.log("DEBUG: getCollectionPageData - 所有数据获取尝试完成，准备返回。");

      // ======================= 诊断日志开始 =======================
      Logger.log("\n--- [DIAGNOSIS] 最终返回给前端的数据摘要 ---");
      Logger.log(`技术新闻 (techNews) 数组长度: ${pageData.techData.techNews.length}`);
      Logger.log(`学术论文 (academicPapers) 数组长度: ${pageData.techData.academicPapers.length}`);
      // 打印 techNews 的前几条记录，检查内容
      if (pageData.techData.techNews.length > 0) {
        Logger.log("--- [DIAGNOSIS] 技术新闻 (techNews) 前3条记录预览 ---");
        Logger.log(JSON.stringify(pageData.techData.techNews.slice(0, 3), null, 2));
      }
      Logger.log("-------------------------------------------------");
      // ==========================================================

      // *** 你原来的日志逻辑保持不变 ***
      Logger.log("DEBUG: 检查 RAW_ACADEMIC_PAPERS 解包后的关键字段:");
      const academicPapers = pageData.techData.academicPapers || [];
      const numToLog = 5;

      for (let i = 0; i < Math.min(academicPapers.length, numToLog); i++) {
          const doc = academicPapers[i];
          Logger.log(`  [学术论文-${i}] ID: ${doc.id}`);
      }
      if (academicPapers.length > numToLog * 2) {
          Logger.log("  ...");
          for (let i = academicPapers.length - numToLog; i < academicPapers.length; i++) {
              const doc = academicPapers[i];
              Logger.log(`  [学术论文-${i}] ID: ${doc.id}`);
          }
      }
      // *******************************************************************

      Logger.log("--- [DIAGNOSIS] getCollectionPageData 即将返回数据 ---");
      return pageData;

    } catch(e) {
      Logger.log(`!!! CRITICAL ERROR in getCollectionPageData: ${e.message} \n ${e.stack}`);
      return JSON.stringify({ error: `获取采集页数据时发生严重错误: ${e.message}.` });
    }
  },

  /**
   * 辅助函数：格式化历史日志数据，并进行排序和截取。
   */
  _formatHistoryLogs: function(rawLogs, limit = 10) {
    if (!Array.isArray(rawLogs)) {
      return [];
    }
    const formatForDisplay = (dateValue, includeTime = false) => {
      if (!dateValue) return 'N/A';
      let dateObj = (dateValue instanceof Date) ? dateValue : new Date(dateValue);
      if (isNaN(dateObj.getTime())) return 'N/A';
      const format = includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd';
      return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
    };

    const processedLogs = rawLogs.map(log => {
      const startTsObj = log.start_timestamp ? new Date(log.start_timestamp) : null;
      const sortableDate = (startTsObj && !isNaN(startTsObj.getTime())) ? startTsObj : new Date(0);
      return {
        sortableDate: sortableDate,
        execution_id: log.execution_id || log.Execution_ID || null,
        workflow_name: log.workflow_name || '未命名工作流',
        start_timestamp: formatForDisplay(log.start_timestamp, true),
        end_timestamp: formatForDisplay(log.end_timestamp, false),
        execution_status: log.execution_status || '未知'
      };
    });

    processedLogs.sort((a, b) => b.sortableDate.getTime() - a.sortableDate.getTime());
    return processedLogs.slice(0, limit);
  },

  /**
   * ✅ 核心修改: getWorkflowExecutionDetail 重构以适配 Firestore
   */
  getWorkflowExecutionDetail: function(executionId) {
    try {
      const doc = FirestoreService.getDocument(`workflow_execution_log/${executionId}`);
      if (!doc) {
        return { error: "未找到该执行记录", execution_id: executionId };
      }
      const detail = {};
      for (var k in doc) {
        detail[k] = (doc[k] instanceof Date) ? doc[k].toISOString() : doc[k];
      }
      return detail;
    } catch(e) {
        return { error: `获取详情失败: ${e.message}`, execution_id: executionId };
    }
  }
};
