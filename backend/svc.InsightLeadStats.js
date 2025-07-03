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
  getStats() {
    try {
      // 这里也可能遇到 Apps Script 读取大表的缓存问题，
      // 但对于 Insight Leads 统计，通常数据量相对较小，
      // 如果未来出现问题，同样需要引入定时任务预处理。
      
      const insights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER');

      const total = insights.length;

      // **新增：计算近7日新增洞察数量**
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 6); 

      const sevenDayNew = insights.filter(item => {
        const itemDate = new Date(item.created_timestamp); // 假设洞察的创建时间是 created_timestamp
        return !isNaN(itemDate.getTime()) && itemDate >= sevenDaysAgo && itemDate <= today;
      }).length;
      // **新增结束**

      const statusCounts = insights.reduce((acc, item) => {
        const status = item.processing_status ? String(item.processing_status).toLowerCase() : 'unknown';
        // 注意：这里的状态映射需要与您的实际数据保持一致
        if (status.includes('signal_identified') || status.includes('pending')) acc.pending++;
        else if (status.includes('analyzing') || status.includes('in_progress')) acc.processing++;
        else if (status.includes('completed') || status.includes('decision_completed')) acc.completed++; // 包含 decision_completed
        else if (status.includes('published')) acc.published++;
        return acc;
      }, { pending: 0, processing: 0, completed: 0, published: 0 });

      return {
        total: total,
        sevenDayNew: sevenDayNew, // **新增：近7日新增量**
        todayUpdated: 0, // 这个字段现在可以废弃或重新定义
        status: statusCounts
      };
      

      // const fakeStats = {
      //   total: 128,
      //   sevenDayNew: 15,
      //   status: {
      //     pending: 45,
      //     processing: 30,
      //     completed: 50,
      //     published: 3
      //   }
      // };
      // Logger.log("成功返回伪造的统计数据: " + JSON.stringify(fakeStats));
      // return fakeStats;
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
