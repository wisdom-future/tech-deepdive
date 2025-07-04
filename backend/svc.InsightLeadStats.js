// 文件名: backend/svc.InsightLeadStats.gs

/**
 * @file 洞察线索统计服务。
 * 负责从核心线索表中获取洞察线索的统计信息。
 * 版本：1.0 - 从Tech_Intelligence_Master获取真实数据，分类统计。
 */

const InsightLeadStatsService = {
  /**
   * 获取洞察线索统计。
   * 包括总量、近7日新增量，以及待处理、处理中、已完成、已发布分类统计。
   * @returns {{total: number, sevenDayNew: number, status: {pending: number, processing: number, completed: number, published: number}}}
   */
    getStats: function() {
    try {
      const insights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER');

      const total = insights.length;

      // --- 修正日期计算逻辑：全部基于 UTC 时间 ---
      const nowUtc = new Date(); // 获取当前时间，但后续计算都基于UTC
      
      // 计算当前日期在UTC时间下的午夜0点 (例如 2025-07-04T00:00:00.000Z)
      const todayUtcMidnight = new Date(Date.UTC(nowUtc.getFullYear(), nowUtc.getMonth(), nowUtc.getDate()));
      
      // 计算7天前（包含今天在内）在UTC时间下的午夜0点 (例如 2025-06-28T00:00:00.000Z)
      // 7天 = 今天 + 过去6天
      const startOfPeriodUtc = new Date(todayUtcMidnight);
      startOfPeriodUtc.setUTCDate(todayUtcMidnight.getUTCDate() - 6); 

      // 计算结束日期在UTC时间下的下一天午夜0点 (例如 2025-07-05T00:00:00.000Z)
      // 这样就可以使用 itemDate >= startOfPeriodUtc && itemDate < endOfPeriodExclusiveUtc
      const endOfPeriodExclusiveUtc = new Date(todayUtcMidnight);
      endOfPeriodExclusiveUtc.setUTCDate(todayUtcMidnight.getUTCDate() + 1);

      Logger.log(`[InsightLeadStatsService] Debugging date range (UTC):`);
      Logger.log(`  Current Server Time (local): ${nowUtc.toLocaleString()}`);
      Logger.log(`  Start of 7-day period (UTC, inclusive): ${startOfPeriodUtc.toISOString()}`);
      Logger.log(`  End of 7-day period (UTC, exclusive): ${endOfPeriodExclusiveUtc.toISOString()}`);
      // --- 修正日期计算逻辑结束 ---

      const sevenDayNew = insights.filter(item => {
        const itemDate = new Date(item.created_timestamp); // Firestore时间戳通常为UTC，会被正确解析为UTC的Date对象
        
        // 检查日期是否有效
        if (isNaN(itemDate.getTime())) {
            Logger.log(`  WARNING: Invalid date found for item ID: ${item.id || 'Unknown'}, created_timestamp: ${item.created_timestamp}`);
            return false;
        }
        
        // 比较：itemDate (UTC) 是否在 [startOfPeriodUtc, endOfPeriodExclusiveUtc) 范围内
        const isInRange = itemDate >= startOfPeriodUtc && itemDate < endOfPeriodExclusiveUtc;
        
        // 调试日志（如果需要更详细的每条数据判断）
        // if (isInRange) {
        //   Logger.log(`    -> Item ${item.id} (created: ${itemDate.toISOString()}) IS IN RANGE.`);
        // } else {
        //   Logger.log(`    -> Item ${item.id} (created: ${itemDate.toISOString()}) IS NOT IN RANGE. Reason: ${itemDate < startOfPeriodUtc ? 'too early' : 'too late'}.`);
        // }

        return isInRange;
      }).length;

      Logger.log(`[InsightLeadStatsService] Calculated sevenDayNew: ${sevenDayNew}`);

      const statusCounts = insights.reduce((acc, item) => {
        const status = item.processing_status ? String(item.processing_status).toLowerCase() : 'unknown';
        if (status.includes('signal_identified') || status.includes('pending')) acc.pending++;
        else if (status.includes('analyzing') || status.includes('in_progress')) acc.processing++;
        else if (status.includes('completed') || status.includes('decision_completed')) acc.completed++;
        else if (status.includes('published')) acc.published++;
        return acc;
      }, { pending: 0, processing: 0, completed: 0, published: 0 });

      return {
        total: total,
        sevenDayNew: sevenDayNew,
        status: statusCounts
      };
      
    } catch (e) {
      Logger.log(`Error in InsightLeadStatsService.getStats: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取洞察线索统计: ${e.message}`);
    }
  }
};

// ====================================================================
//  T E S T   C O D E
// ====================================================================

/**
 * 测试 InsightLeadStatsService 核心功能。
 */
function test_InsightLeadStatsService() {
  Logger.log("======== 开始测试 InsightLeadStatsService ========");
  try {
    const stats = InsightLeadStatsService.getStats();
    Logger.log("✅ 成功获取洞察线索统计:");
    Logger.log(JSON.stringify(stats, null, 2));
    
    if (typeof stats.total === 'number' && stats.total >= 0) {
      Logger.log("✅ 统计数据格式正确。");
    } else {
      Logger.log("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    Logger.log(`❌ InsightLeadStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  Logger.log("\n======== InsightLeadStatsService 测试结束 ========");
}
