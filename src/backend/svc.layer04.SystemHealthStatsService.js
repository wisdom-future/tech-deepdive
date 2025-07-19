/**
 * @file layer04.SystemHealthStatsService.js
 * @description [API服务层] 系统健康与数据统计服务。
 * 继承并取代了原 RawDataStatsService 的功能，成为系统监控的统一入口。
 */

const SystemHealthStatsService = {

  //==================================================================
  // SECTION 1: 系统健康度统计 (System Health)
  //==================================================================

  /**
   * [API] 获取系统健康度统计。
   * @returns {Object} 包含各项健康度百分比和警报信息。
   */
  getSystemHealthStats: function() {
    try {
      // 1. 从工作流日志计算健康度
      // ✅ [对齐CONFIG]
      const logs = DataService.getDataAsObjects('LOG_WORKFLOWS');
      const now = new Date();
      const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const recentLogs = logs.filter(log => {
        const ts = new Date(log.end_timestamp || log.start_timestamp || 0);
        return ts >= oneDayAgo;
      });

      let total = recentLogs.length > 0 ? recentLogs.length : 1; // 避免除以0
      let completed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'completed').length;
      let failed = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'failed').length;
      let warning = recentLogs.filter(log => String(log.execution_status).toLowerCase() === 'warning').length;

      let workflowHealthScore = Math.max(0, Math.round((completed / total) * 100 - failed * 5 - warning * 2));

      // 2. 获取数据质量报告
      let dataQualityScore = 100; // 默认值
      try {
        // ✅ [对齐CONFIG]
        const dqReports = DataService.getDataAsObjects('LOG_DATA_QUALITY', {
            orderBy: { field: 'report_timestamp', direction: 'DESCENDING' },
            limit: 1
        });
        if (dqReports && dqReports.length > 0 && dqReports[0].overall_quality_score) {
            dataQualityScore = parseInt(dqReports[0].overall_quality_score, 10);
        }
      } catch (ex) {
        Logger.log(`[WARN] 获取数据质量报告失败: ${ex.message}`);
      }
      
      // 3. 任务队列积压情况
      const pendingTasksCount = DataService.getDataAsObjects('QUEUE_TASKS', {}).length;

      // 4. 生成系统警报
      let alerts = [];
      if (failed > 0) {
        alerts.push({ type: "error", title: "发现失败流程", message: `过去24小时内有 ${failed} 个工作流执行失败，请立即排查。` });
      }
      if (pendingTasksCount > 100) { // 假设积压阈值为100
        alerts.push({ type: "warning", title: "任务队列积压", message: `当前有 ${pendingTasksCount} 个任务待处理，可能影响数据时效性。` });
      }
      if (alerts.length === 0) {
        alerts.push({ type: "info", title: "系统状态良好", message: "当前系统运行正常，无重要警报。" });
      }

      return {
        overall: Math.round((workflowHealthScore + dataQualityScore) / 2),
        workflow: workflowHealthScore,
        dataQuality: dataQualityScore,
        pendingTasks: pendingTasksCount,
        alerts: alerts
      };
    } catch (e) {
      Logger.log(`[SystemHealthStatsService.getSystemHealthStats] ERROR: ${e.message}`);
      return { overall: 0, workflow: 0, dataQuality: 0, alerts: [{ type: "error", title: "健康度获取失败", message: e.message }] };
    }
  },

  //==================================================================
  // SECTION 2: 原始数据统计 (Raw Data Stats) - 继承自 RawDataStatsService
  //==================================================================
  
  /**
   * [API] 获取各类证据数据的统计信息。
   * @param {Object} options - 包含筛选条件的选项对象 { focusedTechIds, focusedCompetitorIds }。
   * @returns {Object} 原始数据的统计结果。
   */
  getRawDataStats: function(options = {}) {
    const { tech_ids: focusedTechIds = [], competitor_ids: focusedCompetitorIds = [] } = options;
    
    try {
      // ✅ [对齐CONFIG] 定义证据库及其关联的实体ID字段
      const evidenceCategories = [
          { key: 'EVD_PAPERS', name: 'academicPapers', filterIds: focusedTechIds },
          { key: 'EVD_PATENTS', name: 'patentData', filterIds: focusedTechIds },
          { key: 'EVD_OPENSOURCE', name: 'openSourceData', filterIds: focusedTechIds },
          { key: 'EVD_NEWS', name: 'techNews', filterIds: [...focusedTechIds, ...focusedCompetitorIds] },
          { key: 'EVD_DYNAMICS', name: 'industryDynamics', filterIds: focusedCompetitorIds },
          { key: 'EVD_JOBS', name: 'talentFlow', filterIds: focusedCompetitorIds }
          // ...可以根据需要添加更多证据类型的统计
      ];

      const rawDataStats = { total: 0, sevenDayIngestion: 0, categories: {}, sevenDayCategories: {} };
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);

      for (const cat of evidenceCategories) {
        let filters = [];
        // 如果该类别有关联的筛选ID，则构建筛选器
        if (cat.filterIds && cat.filterIds.length > 0) {
          filters.push({
            field: 'linked_entity_ids', // ✅ 统一使用 'linked_entity_ids' 字段进行筛选
            operator: 'ARRAY_CONTAINS_ANY', 
            value: cat.filterIds.slice(0, 10) // Firestore 'in'/'array-contains-any' 最多10个
          });
        }

        const allData = DataService.getDataAsObjects(cat.key, { filters }) || [];
        
        const totalCount = allData.length;
        const sevenDayCount = allData.filter(item => {
            // ✅ 统一使用 'ingestion_timestamp' 作为统计基准
            const itemDate = new Date(item.ingestion_timestamp || 0);
            return !isNaN(itemDate.getTime()) && itemDate >= sevenDaysAgo;
        }).length;

        rawDataStats.categories[cat.name] = totalCount;
        rawDataStats.sevenDayCategories[cat.name] = sevenDayCount;
        rawDataStats.total += totalCount;
        rawDataStats.sevenDayIngestion += sevenDayCount;
      }
      
      return rawDataStats;
    } catch (e) {
      Logger.log(`[SystemHealthStatsService.getRawDataStats] ERROR: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取原始数据统计: ${e.message}`);
    }
  }
};
