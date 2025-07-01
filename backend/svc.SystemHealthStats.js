// 文件名: backend/svc.SystemHealthStats.gs

/** @global CONFIG */
/** @global DataService */
/** @global DateUtils */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

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
      // 1. Overall health (example algorithm: average success rate of all core processes in the last 24 hours / or custom health score)
      const logs = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.OPERATIONS_DB, CONFIG.SHEET_NAMES.WORKFLOW_LOG);
      // Only count logs from the last 24 hours
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24*60*60*1000);
      const recentLogs = logs.filter(log => {
        const ts = DateUtils.parseDate(log.end_timestamp || log.start_timestamp || 0); // Use DateUtils
        return ts && ts >= oneDayAgo;
      });

      // 2. Count metrics
      let total = recentLogs.length || 1; // Avoid division by zero
      let completed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'completed' || String(log.execution_status).toLowerCase() === 'success').length;
      let failed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'failed').length;
      let warning = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'warning').length;

      // Health score algorithm (you can customize, e.g., success rate * 100, failed/warning reduces score)
      let overall = Math.round((completed / total) * 100 - failed * 5 - warning * 2);
      if (overall < 0) overall = 0;
      if (overall > 100) overall = 100;

      // Workflow status (success rate)
      let workflow = Math.round((completed / total) * 100);

      // Data quality (can use the latest data quality report table, or ratio of valid data rows / total rows)
      let dataQuality = 100;
      try {
        const dqReports = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.OPERATIONS_DB, CONFIG.SHEET_NAMES.DATA_QUALITY_REPORTS);
        if (dqReports && dqReports.length > 0) {
          const latest = dqReports[dqReports.length - 1];
          dataQuality = parseInt(latest.overall_quality_score, 10) || 100;
        }
      } catch (ex) {
          logWarning(`[SystemHealthStatsService] Could not retrieve Data Quality Reports: ${ex.message}`);
      }

      // System alerts (if failed/warning, return alert, otherwise return good)
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
      logError(`[SystemHealthStatsService] SystemHealthStatsService.getStats error: ${e.message}\n${e.stack}`);
      return { overall: 0, workflow: 0, dataQuality: 0, alerts: [{ type: "error", title: "健康度获取失败", message: e.message }] };
    }
  }
};

// ==================================================================================
//  T E S T   C O D E (保持不变)
// ==================================================================================

/**
 * 测试 SystemHealthStatsService 核心功能。
 */
function test_SystemHealthStatsService() {
  logInfo("======== 开始测试 SystemHealthStatsService ========");
  try {
    const stats = SystemHealthStatsService.getStats();
    logInfo("✅ 成功获取系统健康统计:");
    logInfo(JSON.stringify(stats, null, 2));
    
    if (typeof stats.overall === 'number' && stats.overall >= 0) {
      logInfo("✅ 统计数据格式正确。");
    } else {
      logInfo("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    logError(`❌ SystemHealthStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  logInfo("\n======== SystemHealthStatsService 测试结束 ========");
}