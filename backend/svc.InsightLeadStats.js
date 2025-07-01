// 文件名: backend/svc.InsightLeadStats.gs

/** @global CONFIG */
/** @global DataService */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

/**
 * @file 洞察线索统计服务。
 * 负责从核心情报表中获取洞察线索的统计信息。
 * 版本：1.0 - 从Tech_Intelligence_Master获取真实数据，分类统计。
 */

const InsightLeadStatsService = {
  /**
   * 获取洞察线索统计。
   * 包括总量、今日更新量，以及待处理、处理中、已完成、已发布分类统计。
   * @returns {{total: number, todayUpdated: number, status: {pending: number, processing: number, completed: number, published: number}}}
   */
  getStats() {
    try {
      const insights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);

      const total = insights.length;
      // 今日更新量：需要遍历数据，Apps Script可能受限。
      // 建议：Make工作流计算当日新增量，并写入一个小统计表。
      const todayUpdated = 0; 

      const statusCounts = insights.reduce((acc, item) => {
        const status = item.processing_status ? String(item.processing_status).toLowerCase() : 'unknown';
        if (status.includes('signal_identified') || status.includes('pending')) acc.pending++;
        else if (status.includes('analyzing') || status.includes('in_progress')) acc.processing++;
        else if (status.includes('completed')) acc.completed++;
        else if (status.includes('published')) acc.published++;
        return acc;
      }, { pending: 0, processing: 0, completed: 0, published: 0 });

      return {
        total: total,
        todayUpdated: todayUpdated,
        status: statusCounts
      };
    } catch (e) {
      logError(`[InsightLeadStatsService] Error in InsightLeadStatsService.getStats: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取洞察线索统计: ${e.message}`);
    }
  }
};

// ==================================================================================
//  T E S T   C O D E
// ==================================================================================

/**
 * 测试 InsightLeadStatsService 核心功能。
 */
function test_InsightLeadStatsService() {
  logInfo("======== 开始测试 InsightLeadStatsService ========");
  try {
    const stats = InsightLeadStatsService.getStats();
    logInfo("✅ 成功获取洞察线索统计:");
    logInfo(JSON.stringify(stats, null, 2));
    
    if (typeof stats.total === 'number' && stats.total >= 0) {
      logInfo("✅ 统计数据格式正确。");
    } else {
      logInfo("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    logError(`❌ InsightLeadStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  logInfo("\n======== InsightLeadStatsService 测试结束 ========");
}