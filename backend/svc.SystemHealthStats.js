// 文件名: backend/svc.SystemHealthStats.gs

/**
 * @file 系统健康度统计服务。
 * 负责获取系统运行状态、工作流健康度、数据质量等信息。
 * 版本：1.3 - 强制返回0或模拟数据，以避免Argument too large错误。
 */

const SystemHealthStatsService = {
  /**
   * 获取系统健康度统计。
   * @returns {Object} 包含各项健康度百分比和警报信息。
   */
  getStats: function() {
    try {
      // 1. 整体健康度（示例算法：所有核心流程近24小时成功率的均值/或自定义健康分数）
      const logs = DataService.getDataAsObjects('WORKFLOW_LOG');
      // 只统计最近24小时的日志
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24*60*60*1000);
      const recentLogs = logs.filter(log => {
        const ts = new Date(log.end_timestamp || log.start_timestamp || 0);
        return ts >= oneDayAgo;
      });

      // 2. 统计各项指标
      let total = recentLogs.length || 1;
      let completed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'completed' || String(log.execution_status).toLowerCase() === 'success').length;
      let failed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'failed').length;
      let warning = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'warning').length;

      // 健康度分数算法（你可自定义，比如成功率*100，失败/警告降低分数）
      let overall = Math.round((completed / total) * 100 - failed * 5 - warning * 2);
      if (overall < 0) overall = 0;
      if (overall > 100) overall = 100;

      // 工作流状态（成功率）
      let workflow = Math.round((completed / total) * 100);

      // 数据质量（可用最近一次的数据质量报告表，或用有效数据行/总行数的比例）
      let dataQuality = 100;
      try {
        const dqReports = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.OPERATIONS_DB, CONFIG.SHEET_NAMES.DATA_QUALITY_REPORTS);
        if (dqReports && dqReports.length > 0) {
          const latest = dqReports[dqReports.length - 1];
          dataQuality = parseInt(latest.overall_quality_score, 10) || 100;
        }
      } catch (ex) {}

      // 系统警报（如有失败/警告则返回警报，否则返回良好）
      let alerts = [];
      if (failed > 0) {
        alerts.push({
          type: "error",
          title: "发现失败流程",
          message: "有 " + failed + " 个流程任务失败，请立即排查。"
        });
      }
      if (warning > 0) {
        alerts.push({
          type: "warning",
          title: "发现警告流程",
          message: "有 " + warning + " 个流程任务出现警告，请关注。"
        });
      }
      if (alerts.length === 0) {
        alerts.push({
          type: "info",
          title: "系统健康度良好",
          message: "当前系统运行正常，无重要警报。"
        });
      }

      return {
        overall: overall,
        workflow: workflow,
        dataQuality: dataQuality,
        alerts: alerts
      };
    } catch (e) {
      Logger.log("SystemHealthStatsService.getStats error: " + e.message);
      return { overall: 0, workflow: 0, dataQuality: 0, alerts: [{ type: "error", title: "健康度获取失败", message: e.message }] };
    }
  }
};

// ====================================================================
//  T E S T   C O D E (保持不变)
// ====================================================================

/**
 * 测试 SystemHealthStatsService 核心功能。
 */
function test_SystemHealthStatsService() {
  Logger.log("======== 开始测试 SystemHealthStatsService ========");
  try {
    const stats = SystemHealthStatsService.getStats();
    Logger.log("✅ 成功获取系统健康统计:");
    Logger.log(JSON.stringify(stats, null, 2));
    
    if (typeof stats.overall === 'number' && stats.overall >= 0) {
      Logger.log("✅ 统计数据格式正确。");
    } else {
      Logger.log("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    Logger.log(`❌ SystemHealthStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  Logger.log("\n======== SystemHealthStatsService 测试结束 ========");
}

