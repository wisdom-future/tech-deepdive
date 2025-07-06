// 文件名: backend/svc.CollectionStats.gs (最终 Firestore 适配版)

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
   */
  getCollectionPageData: function() {
    try {
      Logger.log("DEBUG: getCollectionPageData - 开始获取数据...");
      
      // ✅ 为每个数据块提供默认的空值
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

      // 使用 try-catch 包裹每一个数据获取，防止一个失败导致全部失败
      try { pageData.techData.academicPapers = DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS'); } catch (e) { Logger.log(`获取 RAW_ACADEMIC_PAPERS 失败: ${e.message}`); }
      try { pageData.techData.patentData = DataService.getDataAsObjects('RAW_PATENT_DATA'); } catch (e) { Logger.log(`获取 RAW_PATENT_DATA 失败: ${e.message}`); }
      try { pageData.techData.openSourceData = DataService.getDataAsObjects('RAW_OPENSOURCE_DATA'); } catch (e) { Logger.log(`获取 RAW_OPENSOURCE_DATA 失败: ${e.message}`); }
      try { pageData.techData.techNews = DataService.getDataAsObjects('RAW_TECH_NEWS'); } catch (e) { Logger.log(`获取 RAW_TECH_NEWS 失败: ${e.message}`); }
      
      try { pageData.benchmarkData.industryDynamics = DataService.getDataAsObjects('RAW_INDUSTRY_DYNAMICS'); } catch (e) { Logger.log(`获取 RAW_INDUSTRY_DYNAMICS 失败: ${e.message}`); }
      try { pageData.benchmarkData.competitorIntelligence = DataService.getDataAsObjects('RAW_COMPETITOR_INTELLIGENCE'); } catch (e) { Logger.log(`获取 RAW_COMPETITOR_INTELLIGENCE 失败: ${e.message}`); }

      try { pageData.competitors = DataService.getDataAsObjects('COMPETITOR_REGISTRY').map(c => ({ id: c.competitor_id, name: c.company_name })); } catch (e) { Logger.log(`获取 COMPETITOR_REGISTRY 失败: ${e.message}`); }
      
      try { pageData.history = this._formatHistoryLogs(DataService.getDataAsObjects('WORKFLOW_LOG')); } catch (e) { Logger.log(`获取 WORKFLOW_LOG 失败: ${e.message}`); }
      
      try { pageData.overallStats = computeCollectionStats(); } catch (e) { Logger.log(`计算 overallStats 失败: ${e.message}`); }
      
      Logger.log("DEBUG: getCollectionPageData - 所有数据获取尝试完成，准备返回。");

       // *** 改为以下更精简的日志，只查看 academicPapers 的前几条和后几条 ***
      Logger.log("DEBUG: 检查 RAW_ACADEMIC_PAPERS 解包后的关键字段:");
      const academicPapers = pageData.techData.academicPapers || [];
      const numToLog = 5; // 只打印前5条和后5条

      // 打印前几条
      for (let i = 0; i < Math.min(academicPapers.length, numToLog); i++) {
          const doc = academicPapers[i];
          Logger.log(`  [学术论文-${i}] ID: ${doc.id}`);
          Logger.log(`    Title: "${doc.title}"`);
          Logger.log(`    Authors: "${doc.authors}"`);
          Logger.log(`    Publication Date: "${doc.publication_date}"`);
          Logger.log(`    AI Innovation Score: "${doc.innovation_score_ai}"`);
      }

      // 如果总数超过需要打印的数量的两倍，则打印中间省略号和后几条
      if (academicPapers.length > numToLog * 2) {
          Logger.log("  ..."); // 表示中间有省略
          for (let i = academicPapers.length - numToLog; i < academicPapers.length; i++) {
              const doc = academicPapers[i];
              Logger.log(`  [学术论文-${i}] ID: ${doc.id}`);
              Logger.log(`    Title: "${doc.title}"`);
              Logger.log(`    Authors: "${doc.authors}"`);
              Logger.log(`    Publication Date: "${doc.publication_date}"`);
              Logger.log(`    AI Innovation Score: "${doc.innovation_score_ai}"`);
          }
      }
      // *******************************************************************

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
      // 在 Firestore 中，我们可以直接通过 ID 获取文档，效率极高
      const doc = FirestoreService.getDocument(`workflow_execution_log/${executionId}`);
      if (!doc) {
        return { error: "未找到该执行记录", execution_id: executionId };
      }
      // 将可能的 Date 对象转为字符串（如果需要）
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
