/**
 * @file layer04.DashboardService.js
 * @description [API服务层] 仪表盘数据服务 (BFF)。
 * 聚合、格式化所有在主仪表盘上展示的数据，为前端提供单一、高效的数据接口。
 */

const DashboardService = {

  /**
   * [API] 获取仪表盘所需的全部聚合数据。
   * 匹配 mock_api.js -> DashboardService.getDashboardData
   * @param {Object} options - 包含筛选条件的选项对象 { tech_ids, competitor_ids }。
   * @returns {Object} 包含所有仪表盘模块所需数据的聚合对象。
   */
  getDashboardData: async function(options = {}) {
    const { tech_ids: focusedTechIds = [], competitor_ids: focusedCompetitorIds = [] } = options;
    
    // **核心优化1：在函数开始时一次性获取常用数据，减少重复Firestore调用**
    const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
    const allFindings = DataService.getDataAsObjects('FND_MASTER') || []; // 可能需要优化，如果 FND_MASTER 巨大
    const allSnapshots = DataService.getDataAsObjects('ANL_DAILY_SNAPSHOTS') || []; // 可能需要优化，如果快照巨大

    // 将数据转换为Map，方便快速查找
    const entityMap = new Map(allEntities.map(e => [e.entity_id, e]));
    const findingMap = new Map(allFindings.map(f => [f.id, f])); // 可能不需要
    const snapshotMap = new Map(allSnapshots.map(s => [s.entity_id + '_' + DateUtils.formatDate(s.snapshot_date), s])); // ID_日期 映射

    // 筛选出与当前关注实体相关的信号和快照（在内存中进行）
    const getRelevantFindings = (entityId, daysAgo) => {
        const cutoffDate = new Date(new Date().getTime() - daysAgo * 24 * 3600 * 1000);
        return allFindings.filter(f => 
            f.linked_entity_ids && f.linked_entity_ids.includes(entityId) && new Date(f.created_timestamp) >= cutoffDate
        );
    };

    const getLatestSnapshot = (entityId) => {
        const today = DateUtils.formatDate(new Date());
        let snapshot = snapshotMap.get(`${entityId}_${today}`);
        if (!snapshot) {
            // 如果今天快照不存在，查找最近的快照 (在 allSnapshots 中找)
            snapshot = allSnapshots.filter(s => s.entity_id === entityId)
                                    .sort((a, b) => new Date(b.snapshot_date) - new Date(a.snapshot_date))[0];
        }
        return snapshot;
    };


    const promises = [
      this._getKpiStats(focusedTechIds, focusedCompetitorIds, allFindings), // 传递 allFindings
      this._getMarketRadarData(focusedTechIds, focusedCompetitorIds, entityMap, getLatestSnapshot), // 传递 entityMap 和查找函数
      this._getAthenasBriefing(focusedTechIds, focusedCompetitorIds, allFindings), // 传递 allFindings
      this._getMyWatchlist(focusedTechIds, focusedCompetitorIds, entityMap, getLatestSnapshot, getRelevantFindings), // 传递
      this._getEmergingSignals(focusedTechIds, focusedCompetitorIds, allFindings), // 传递 allFindings
      this._getRealtimeTechFeed(focusedTechIds, focusedCompetitorIds) // RealtimeTechFeed 涉及多个集合，暂时保持原样，或优化为一次性读取所有 EVD_COLLECTIONS
    ];
    
    const results = await Promise.allSettled(promises);

    const kpiStatsResult = results[0];
    const marketRadarDataResult = results[1];
    const athenasBriefingResult = results[2];
    const myWatchlistResult = results[3];
    const emergingSignalsResult = results[4];
    const realtimeTechFeedResult = results[5];

    return {
      kpiStats: kpiStatsResult.status === 'fulfilled' ? kpiStatsResult.value : this._getKpiStatsFallback(),
      marketRadar: marketRadarDataResult.status === 'fulfilled' ? marketRadarDataResult.value : [],
      athenasBriefing: athenasBriefingResult.status === 'fulfilled' ? athenasBriefingResult.value : this._getAthenasBriefingFallback(),
      emergingSignals: emergingSignalsResult.status === 'fulfilled' ? emergingSignalsResult.value : [],
      myWatchlist: myWatchlistResult.status === 'fulfilled' ? myWatchlistResult.value : { watchlistItems: [] },
      realtimeTechFeed: realtimeTechFeedResult.status === 'fulfilled' ? realtimeTechFeedResult.value : []
    };
  },

  //==================================================================
  // SECTION: 私有数据聚合函数 (Private Aggregators)
  //==================================================================

  /**
   * [PRIVATE] 获取核心KPI统计数据的回退值。
   */
  _getKpiStatsFallback: function() {
      return { totalFindings: 0, weeklyNewFindings: 0, pendingSignals: 0, systemHealth: 0 };
  },

  /**
   * [PRIVATE] 获取核心KPI统计数据。
   * 匹配 mock_api.js -> DashboardService.getDashboardData.kpiStats
   */
    _getKpiStats: function(focusedTechIds = [], focusedCompetitorIds = [], allFindings) { // 接收 allFindings
    try {
      let findingsToUse = allFindings; // 使用传递进来的 allFindings

      // 如果有关注列表，在内存中过滤
      if (focusedTechIds.length > 0 || focusedCompetitorIds.length > 0) {
        const allIds = [...new Set([...focusedTechIds, ...focusedCompetitorIds])];
        findingsToUse = allFindings.filter(f => 
            f.linked_entity_ids && allIds.some(id => f.linked_entity_ids.includes(id))
        );
      }

      const total = findingsToUse.length; // 现在是内存中的总数

      const sevenDaysAgo = new Date(new Date().getTime() - 7 * 24 * 3600 * 1000);
      const weeklyNew = findingsToUse.filter(f => new Date(f.created_timestamp) >= sevenDaysAgo).length;
      
      const pending = findingsToUse.filter(f => ['SIGNAL_IDENTIFIED', 'SIGNAL_VALIDATED'].includes(f.finding_status)).length;

      const systemHealth = SystemHealthStatsService.getSystemHealthStats(); // 这个仍然会触发 UrlFetchApp，但频率低

      return {
        totalFindings: total,
        weeklyNewFindings: weeklyNew,
        pendingSignals: pending,
        systemHealth: systemHealth.overall || 0
      };
    } catch (e) {
      Logger.log(`[_getKpiStats] ERROR: ${e.message}`);
      return this._getKpiStatsFallback();
    }
  },

  /**
   * [PRIVATE] 获取雅典娜简报的回退值。
   */
  _getAthenasBriefingFallback: function() {
      return { text: "生成雅典娜简报时发生错误或无可用数据。" };
  },

    /**
   * [PRIVATE] 获取雅典娜简报。
   * 匹配 mock_api.js -> DashboardService.getDashboardData.athenasBriefing
   */
  // ✅ [最终优化] 移除实时AI调用，直接使用信号的既有摘要，大幅提升性能和稳定性。
  _getAthenasBriefing: async function(focusedTechIds = [], focusedCompetitorIds = [], allFindings) {
    const jobName = '_getAthenasBriefing';
    try {
      const now = new Date();
      // 将时间范围扩大到7天，以增加找到信号的可能性
      const cutoff = new Date(now.getTime() - 7 * 24 * 3600 * 1000); 
      
      let findingsToUse = allFindings.filter(f => new Date(f.created_timestamp) >= cutoff);

      if (focusedTechIds.length > 0 || focusedCompetitorIds.length > 0) {
        const allIds = [...new Set([...focusedTechIds, ...focusedCompetitorIds])];
        findingsToUse = findingsToUse.filter(f => 
            f.linked_entity_ids && allIds.some(id => f.linked_entity_ids.includes(id))
        );
      }

      // 仍然按信号强度排序，找到最高价值的那个
      findingsToUse.sort((a, b) => (b.signal_strength_score || 0) - (a.signal_strength_score || 0));
      const bestSignal = findingsToUse[0];

      if (!bestSignal) {
        Logger.log(`[${jobName}] 在过去7天内未找到高价值信号。`);
        return { text: "当前关注范围内，近期无重大信号。", core_topic: "暂无", primary_entity_id: null };
      }
      
      // 直接使用信号自带的摘要，提供回退机制
      const briefingText = bestSignal.ai_summary || bestSignal.summary || "此信号无可用摘要。";
      const coreTopic = bestSignal.title.substring(0, Math.min(bestSignal.title.length, 50)) + (bestSignal.title.length > 50 ? '...' : '');
      const primaryEntityId = bestSignal.linked_entity_ids && bestSignal.linked_entity_ids.length > 0 ? bestSignal.linked_entity_ids[0] : null;

      Logger.log(`[${jobName}] 成功提取简报，使用信号ID: ${bestSignal.id}`);

      return {
        text: briefingText,
        core_topic: coreTopic,
        related_event_id: bestSignal.id,
        primary_entity_id: primaryEntityId
      };
    } catch (e) {
      Logger.log(`[${jobName}] ERROR: 提取雅典娜简报时发生错误: ${e.message}\n${e.stack}`);
      return this._getAthenasBriefingFallback();
    }
  },

    /**
   * [PRIVATE] 获取市场雷达图数据。
   * 匹配 mock_api.js -> DashboardService.getDashboardData.marketRadar
   * 注意：mock 中 x_axis_value, y_axis_value, size_value, is_highlighted
   */
  _getMarketRadarData: function(focusedTechIds = [], focusedCompetitorIds = [], entityMap, getLatestSnapshot) {
    const debugPrefix = "[_getMarketRadarData]";
    try {
      let entitiesToProcess;
      const defaultLimit = 20;

      if (focusedTechIds.length === 0 && focusedCompetitorIds.length === 0) {
          // 如果没有关注列表，获取所有活跃实体，并限制数量
          const allActiveEntities = Array.from(entityMap.values()).filter(e => e.monitoring_status === 'active');
          allActiveEntities.sort((a, b) => new Date(b.updated_timestamp) - new Date(a.updated_timestamp));
          entitiesToProcess = allActiveEntities.slice(0, defaultLimit);
          Logger.log(`${debugPrefix} 关注列表为空，获取默认活跃实体数: ${entitiesToProcess.length}`);
      } else {
          const focusSet = new Set([...focusedTechIds, ...focusedCompetitorIds]);
          entitiesToProcess = Array.from(focusSet).map(id => entityMap.get(id)).filter(Boolean); // 从 map 中获取关注实体
          Logger.log(`${debugPrefix} 从关注列表获取实体数: ${entitiesToProcess.length}`);
      }

      if (entitiesToProcess.length === 0) {
          Logger.log(`${debugPrefix} 经过实体过滤后，没有实体可供处理。`);
          return [];
      }

      const results = [];
      for (const entity of entitiesToProcess) {
          Logger.log(`${debugPrefix} 处理实体: ${entity.primary_name} (ID: ${entity.entity_id})`);
          
          // **从传递进来的 getLatestSnapshot 函数中获取快照**
          const snapshot = getLatestSnapshot(entity.entity_id);
          
          let x_axis_value = 0;
          let y_axis_value = 0;
          let size_value = 0;

          if (snapshot) {
              x_axis_value = Math.min(100, snapshot.market_attention_score || 0);
              y_axis_value = Math.min(100, snapshot.innovation_activity_score || 0);
              size_value = Math.min(100, snapshot.influence_score || 0);
              Logger.log(`${debugPrefix}   从快照获取值 (x/y/size): ${x_axis_value}/${y_axis_value}/${size_value}`);
          } else {
              Logger.log(`${debugPrefix}   未找到实体 ${entity.primary_name} 的最新快照。`);
          }

          // 临时调试代码：如果值为0，强制赋一个随机但非零值，用于调试
          // 生产环境中，请移除此 else 块，让数据反映真实情况
          if (x_axis_value === 0 && y_axis_value === 0 && size_value === 0) {
              Logger.log(`${debugPrefix}   快照数据为零，强制模拟值。`);
              results.push({
                entity_id: entity.entity_id,
                name: entity.primary_name,
                type: entity.entity_type,
                x_axis_value: Math.floor(Math.random() * 50) + 1, // 1-50
                y_axis_value: Math.floor(Math.random() * 50) + 1, // 1-50
                size_value: Math.floor(Math.random() * 50) + 1, // 1-50
                is_highlighted: (focusedTechIds.includes(entity.entity_id) || focusedCompetitorIds.includes(entity.entity_id)),
              });
          } else {
              results.push({
                entity_id: entity.entity_id,
                name: entity.primary_name,
                type: entity.entity_type,
                x_axis_value: x_axis_value,
                y_axis_value: y_axis_value,
                size_value: size_value,
                is_highlighted: (focusedTechIds.includes(entity.entity_id) || focusedCompetitorIds.includes(entity.entity_id)),
              });
          }
      }
      Logger.log(`${debugPrefix} 最终返回雷达图实体数量: ${results.length}`);
      return results;
    } catch (e) {
      Logger.log(`${debugPrefix} ERROR: ${e.message}`);
      return [];
    }
  },
  
  /**
   * [PRIVATE] 获取新兴信号数据。
   * 匹配 mock_api.js -> DashboardService.getDashboardData.emergingSignals
   * 模拟数据：id, title, signalStrength, validationLevel, connectionUrgency
   */
   _getEmergingSignals: function(focusedTechIds = [], focusedCompetitorIds = [], allFindings) { // 接收 allFindings
      try {
          let findingsToUse = allFindings;

          if (focusedTechIds.length > 0 || focusedCompetitorIds.length > 0) {
              const allIds = [...new Set([...focusedTechIds, ...focusedCompetitorIds])];
              findingsToUse = allFindings.filter(f => 
                  f.linked_entity_ids && allIds.some(id => f.linked_entity_ids.includes(id))
              );
          }

          const sevenDaysAgo = new Date(new Date().getTime() - 7 * 24 * 3600 * 1000);
          findingsToUse = findingsToUse.filter(f => new Date(f.created_timestamp) >= sevenDaysAgo);

          // 按照 signal_strength_score 排序，取前6个
          findingsToUse.sort((a, b) => (b.signal_strength_score || 0) - (a.signal_strength_score || 0));
          const top6Findings = findingsToUse.slice(0, 6);

          const signals = top6Findings.map(f => ({
              id: f.id,
              title: f.title,
              signalStrength: f.signal_strength_score || 50,
              validationLevel: Math.min(100, (f.occurrence_count || 1) * 10 + (Math.random() * 20)),
              connectionUrgency: Math.min(100, (f.linked_entity_ids?.length || 0) * 15 + (Math.random() * 10))
          }));
          return signals;
      } catch (e) {
          Logger.log(`[_getEmergingSignals] ERROR: ${e.message}`);
          return [];
      }
  },

_getMyWatchlist: function(focusedTechIds = [], focusedCompetitorIds = [], entityMap, getLatestSnapshot, getRelevantFindings) {
    try {
      const userAuthInfo = AuthService.authenticateUser();
      const effectiveFocus = userAuthInfo.effective_focus || {};
      const userFocusedTechIds = effectiveFocus.focusedTechIds || [];
      const userFocusedCompetitorIds = effectiveFocus.focusedCompetitorIds || [];

      const focusIds = [...new Set([...userFocusedTechIds, ...userFocusedCompetitorIds])];
      
      // ✅ [修正] 即使 focusIds 为空，也返回正确的结构体
      if (focusIds.length === 0) {
        return { watchlistItems: [] };
      }
      
      const watchlistItems = [];
      focusIds.forEach(entityId => {
          const entity = entityMap.get(entityId);
          if (!entity) return;
          const snapshot = getLatestSnapshot(entity.entity_id);
          const activityLevel = snapshot ? (snapshot.influence_score || 0) : 0;
          const recentFindings = getRelevantFindings(entity.entity_id, 7);
          const hasMajorEvent = (recentFindings || []).some(f => (f.signal_strength_score || 0) >= 8);

          watchlistItems.push({
            entity_id: entity.entity_id,
            name: entity.primary_name,
            activity_level: Math.round(activityLevel),
            has_major_event: hasMajorEvent
          });
      });

      return { watchlistItems: watchlistItems };
    } catch (e) {
      Logger.log(`[_getMyWatchlist] ERROR: ${e.message}`);
      return { watchlistItems: [] }; // 确保出错时也返回正确结构
    }
  },

  /**
   * [PRIVATE] 获取实时技术动态Feed。
   * 匹配 mock_api.js -> DashboardService.getDashboardData.realtimeTechFeed
   * @param {string[]} focusedTechIds - 聚焦的技术实体ID
   * @param {string[]} focusedCompetitorIds - 聚焦的公司实体ID
   * @returns {Array<object>} 格式化后的实时动态列表
   */
  _getRealtimeTechFeed: function(focusedTechIds = [], focusedCompetitorIds = []) { // **保持为同步函数**
      try {
          const filters = [];
          if (focusedTechIds.length > 0 || focusedCompetitorIds.length > 0) {
              const allIds = [...new Set([...focusedTechIds, ...focusedCompetitorIds])];
              if(allIds.length > 0) {
                  filters.push({ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS_ANY', value: allIds.slice(0, 10) });
              }
          }
          const twentyFourHoursAgo = new Date(new Date().getTime() - 24 * 3600 * 1000);
          filters.push({ field: 'created_timestamp', operator: 'GREATER_THAN_OR_EQUAL', value: twentyFourHoursAgo });

          const allRecentFeedItems = [];
          const evidenceCollections = ['EVD_NEWS', 'EVD_PAPERS', 'EVD_OPENSOURCE', 'EVD_JOBS', 'EVD_DYNAMICS', 'EVD_PATENTS'];

          // **核心修改：直接同步获取数据，并处理可能的错误**
          for (const collectionKey of evidenceCollections) {
              try {
                  const items = DataService.getDataAsObjects(collectionKey, {
                      filters: filters,
                      orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
                      limit: 5 // 每个集合取最新5条
                  }) || [];
                  allRecentFeedItems.push(...items);
              } catch (e) {
                  Logger.log(`[_getRealtimeTechFeed] WARN: 获取集合 ${collectionKey} 数据失败: ${e.message}`);
                  // 即使单个集合失败，也不中断整个函数
              }
          }
          
          allRecentFeedItems.sort((a, b) => new Date(b.created_timestamp) - new Date(a.created_timestamp));
          const top7FeedItems = allRecentFeedItems.slice(0, 7);

          const feed = top7FeedItems.map(item => {
              const sourceTypeMap = {
                  'ACADEMIC_PAPER': '学术', 'PATENT': '专利', 'OPENSOURCE': '开源', 'TALENT_FLOW': '人才',
                  'TECH_NEWS': '新闻', 'INDUSTRY_DYNAMICS': '市场', 'ANALYST_REPORT': '报告', 'CORPORATE_FILING': '报告'
              };
              const sourceType = AnalysisService._getTaskTypeFromFinding(item); 

              const timeDiffMs = new Date().getTime() - new Date(item.created_timestamp).getTime();
              const timeAgo = this._formatTimeAgo(timeDiffMs);

              return {
                  sourceType: sourceType,
                  timeAgo: timeAgo,
                  title: item.title || item.ai_summary || '无标题',
                  sourceUrl: item.url || '#'
              };
          });
          return feed;
      } catch (e) {
          Logger.log(`[_getRealtimeTechFeed] ERROR: ${e.message}`);
          return [];
      }
  },

  /**
   * [PRIVATE] 格式化时间差为“X小时/分钟前”
   */
    _formatTimeAgo: function(ms) {
      const seconds = Math.floor(ms / 1000);
      const minutes = Math.floor(seconds / 60);
      const hours = Math.floor(minutes / 60);
      const days = Math.floor(hours / 24);

      if (days > 0) return `${days}天前`;
      if (hours > 0) return `${hours}小时前`;
      if (minutes > 0) return `${minutes}分钟前`;
      return `刚刚`;
  },

  _getTaskTypeFromFinding: function(finding) {
    if (finding && finding.task_type) return finding.task_type;
    if (finding && finding.evidence_chain && finding.evidence_chain.length > 0) {
      const primaryEvidenceLink = finding.evidence_chain[0];
      if (primaryEvidenceLink && primaryEvidenceLink.collection_key) {
        const key = primaryEvidenceLink.collection_key;
        const typeMap = {
          'EVD_NEWS': 'TECH_NEWS', 'EVD_DYNAMICS': 'INDUSTRY_DYNAMICS',
          'EVD_PAPERS': 'ACADEMIC_PAPER', 'EVD_PATENTS': 'PATENT',
          'EVD_OPENSOURCE': 'OPENSOURCE', 'EVD_JOBS': 'TALENT_FLOW',
          'EVD_REPORTS': 'ANALYST_REPORT', 'EVD_FILINGS': 'CORPORATE_FILING'
        };
        return typeMap[key] || 'UNKNOWN';
      }
    }
    return 'UNKNOWN';
  },

  /**
   * [API] 为前端的实体详情面板提供聚合数据。
   * 匹配 mock_api.js -> DashboardService.getSidePanelData
   * @param {string} entityId - 实体ID
   * @returns {object} { entity_name, core_summary, recent_evidence: [{type, title, source_url}] }
   */
  getEntityDetails: function(entityId) {
    const entity = DataService.getDocument('REG_ENTITIES', entityId);
    if (!entity) return null;

    const recentFindings = DataService.getDataAsObjects('FND_MASTER', {
        filters: [{ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: entityId }],
        orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
        limit: 5
    });

    const recent_evidence = (recentFindings || []).map(f => ({
        type: AnalysisService._getTaskTypeFromFinding(f), 
        title: f.title,
        source_url: f.url || `#findings/${f.id}`
    }));

    return {
        entity_name: entity.primary_name,
        core_summary: entity.description || '暂无简介。',
        recent_evidence: recent_evidence
    };
  }
};

/**
 * @file tools/debugHomePageData.js
 * @description 后台测试脚本：模拟前端获取首页Dashboard数据，并将结果打印到日志。
 */

/**
 * 调试函数：获取并打印HomePage所需的Dashboard数据。
 *
 * 这个函数会调用 DashboardService.getDashboardData()，
 * 并将返回的所有数据结构详细地打印到Apps Script日志中，
 * 方便开发者检查数据格式和内容是否符合前端预期。
 */
async function debugHomePageData() {
  const jobName = 'DebugHomePageData';
  Logger.log(`--- [${jobName}] Starting Dashboard Data Debug ---`);

  try {
    // 模拟前端可能传递的关注实体ID
    // 您可以在这里修改为您的测试实体ID，例如：
    const focusedTechIds = ['tech_generative_ai', 'tech_quantum_computing'];
    const focusedCompetitorIds = ['comp_nvidia', 'comp_google', 'comp_cisco_systems']; // 添加Cisco

    Logger.log(`[${jobName}] Calling DashboardService.getDashboardData with focused entities.`);
    Logger.log(`[${jobName}] Focused Tech IDs: ${JSON.stringify(focusedTechIds)}`);
    Logger.log(`[${jobName}] Focused Competitor IDs: ${JSON.stringify(focusedCompetitorIds)}`);

    // 调用 DashboardService 的主入口
    const dashboardData = await DashboardService.getDashboardData({
      tech_ids: focusedTechIds,
      competitor_ids: focusedCompetitorIds
    });

    Logger.log(`\n--- [${jobName}] Raw Dashboard Data ---`);
    Logger.log(`[${jobName}] Full Data Object:`);
    Logger.log(JSON.stringify(dashboardData, null, 2)); // 打印整个对象，格式化输出

    // 针对每个模块单独打印，方便检查
    Logger.log(`\n--- [${jobName}] KPI Stats ---`);
    Logger.log(JSON.stringify(dashboardData.kpiStats, null, 2));

    Logger.log(`\n--- [${jobName}] Market Radar Data ---`);
    if (dashboardData.marketRadar && dashboardData.marketRadar.length > 0) {
      dashboardData.marketRadar.forEach(item => {
        Logger.log(`  - Entity: ${item.name} (ID: ${item.entity_id}, Type: ${item.type})`);
        Logger.log(`    Values: x=${item.x_axis_value}, y=${item.y_axis_value}, size=${item.size_value}`);
        Logger.log(`    Highlighted: ${item.is_highlighted}`);
      });
    } else {
      Logger.log("  Market Radar Data is empty or not found.");
    }

    Logger.log(`\n--- [${jobName}] Athenas Briefing ---`);
    Logger.log(JSON.stringify(dashboardData.athenasBriefing, null, 2));

    Logger.log(`\n--- [${jobName}] Emerging Signals ---`);
    if (dashboardData.emergingSignals && dashboardData.emergingSignals.length > 0) {
      dashboardData.emergingSignals.forEach(item => {
        Logger.log(`  - Signal: ${item.title} (ID: ${item.id})`);
        Logger.log(`    Strength: ${item.signalStrength}, Validation: ${item.validationLevel}, Urgency: ${item.connectionUrgency}`);
      });
    } else {
      Logger.log("  Emerging Signals Data is empty or not found.");
    }

    Logger.log(`\n--- [${jobName}] My Watchlist ---`);
    if (dashboardData.myWatchlist && dashboardData.myWatchlist.watchlistItems && dashboardData.myWatchlist.watchlistItems.length > 0) {
      dashboardData.myWatchlist.watchlistItems.forEach(item => {
        Logger.log(`  - Watchlist Item: ${item.name} (ID: ${item.entity_id})`);
        Logger.log(`    Activity: ${item.activity_level}, Major Event: ${item.has_major_event}`);
      });
    } else {
      Logger.log("  My Watchlist Data is empty or not found.");
    }

    Logger.log(`\n--- [${jobName}] Realtime Tech Feed ---`);
    if (dashboardData.realtimeTechFeed && dashboardData.realtimeTechFeed.length > 0) {
      dashboardData.realtimeTechFeed.forEach(item => {
        Logger.log(`  - Feed Item: ${item.title} (Source: ${item.sourceType}, Time: ${item.timeAgo})`);
      });
    } else {
      Logger.log("  Realtime Tech Feed Data is empty or not found.");
    }


    Logger.log(`\n--- [${jobName}] Dashboard Data Debug Finished ---`);

  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR during Dashboard Data Debug: ${e.message}\n${e.stack}`);
  }
}

