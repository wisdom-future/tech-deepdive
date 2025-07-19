/**
 * @file layer09.TechnologyHistoryService.js
 * @description [特殊服务层] 负责处理技术演进历史相关的数据构建与查询。
 */

const TechnologyHistoryService = {

  /**
   * [后台工作流] 为指定技术构建或重建其发展时间轴。
   * @param {string} techId - 技术的实体ID。
   * @returns {{success: boolean, message: string}}
   */
  buildTechnologyTimeline: function(techId) {
    const jobName = `HistoryBuilder for ${techId}`;
    Logger.log(`[${jobName}] 开始构建时间轴...`);
    const milestones = [];
    
    // ✅ [对齐CONFIG] 使用 'REG_ENTITIES' 获取技术信息
    const techInfo = DataService.getDocument('REG_ENTITIES', techId);
    if (!techInfo || techInfo.entity_type !== 'Technology') {
      return { success: false, message: `未在 'REG_ENTITIES' 中找到技术ID: ${techId}` };
    }
    
    // 使用 Helpers.getSearchKeywordsForEntity 来获取搜索关键词
    const keywords = Helpers.getSearchKeywordsForEntity(techInfo);
    if (keywords.length === 0) {
      return { success: false, message: `技术 '${techId}' 未配置关键词。` };
    }

    const containsKeyword = (text) => {
      if (!text) return false;
      const lowerText = String(text).toLowerCase();
      return keywords.some(kw => lowerText.includes(kw.toLowerCase())); // 确保关键词匹配时也转小写
    };

    // 定义数据源及其对应的证据库键名
    const dataSources = [
      { key: 'EVD_PAPERS', type: 'Pioneering Paper', dateField: 'publication_timestamp', titleField: 'title', authorField: 'authors', urlField: 'url', summaryField: 'summary' },
      { key: 'EVD_PATENTS', type: 'Key Patent', dateField: 'publication_timestamp', titleField: 'title', authorField: 'inventors', urlField: 'url', summaryField: 'summary' },
      { key: 'EVD_OPENSOURCE', type: 'Major Release', dateField: 'publication_timestamp', titleField: 'title', authorField: 'owner', urlField: 'url', summaryField: 'summary' },
      { key: 'EVD_NEWS', type: 'News Highlight', dateField: 'publication_timestamp', titleField: 'title', authorField: 'author', urlField: 'url', summaryField: 'summary' }
    ];

    dataSources.forEach(source => {
      try {
        const items = DataService.getDataAsObjects(source.key) || [];
        items.forEach(item => {
          const textToSearch = `${item[source.titleField] || ''} ${item[source.summaryField] || ''}`;
          if (containsKeyword(textToSearch)) {
            const milestoneDate = item[source.dateField] ? new Date(item[source.dateField]) : null;
            if (!milestoneDate || isNaN(milestoneDate.getTime())) return;

            const milestone = {
              id: `mstone_${techId}_${milestoneDate.getTime()}`,
              tech_id: techId,
              milestone_date: milestoneDate,
              milestone_type: source.type,
              title: item[source.titleField],
              summary: item.ai_summary || String(item[source.summaryField] || '').substring(0, 300),
              source_url: item[source.urlField],
              source_evidence_id: item.id,
              created_timestamp: new Date()
            };
            milestones.push(milestone);
          }
        });
      } catch(e) {
        Logger.log(`[${jobName}] 扫描集合 ${source.key} 时出错: ${e.message}`);
      }
    });
    
    if (milestones.length > 0) {
      DataService.batchUpsert('ANL_TECH_MILESTONES', milestones, 'id');
    }

    return { success: true, message: `为 ${techId} 成功构建了 ${milestones.length} 个里程碑。` };
  },

  /**
   * [API] 为前端 "技术时空锥" 可视化准备数据。
   * @param {string} techId
   * @returns {{nodes: Array<Object>, edges: Array<Object>}}
   */
  getTechnologySpacetimeConeData: function(techId) {
    const jobName = `SpacetimeCone for ${techId}`;
    Logger.log(`[${jobName}] 开始准备时空锥数据...`);

    const milestones = DataService.getDataAsObjects('ANL_TECH_MILESTONES', {
        filters: [{ field: 'tech_id', operator: 'EQUAL', value: techId }],
        orderBy: { field: 'milestone_date', direction: 'ASCENDING' }
    });

    if (!milestones || milestones.length === 0) {
      return { nodes: [], edges: [] };
    }

    const nodes = [];
    const edges = [];
    const nodeMap = new Map(); // 存储已添加的节点，防止重复

    let minDate = new Date();
    let maxDate = new Date(0); // Epoch

    milestones.forEach(m => {
        const mDate = new Date(m.milestone_date);
        if (mDate < minDate) minDate = mDate;
        if (mDate > maxDate) maxDate = mDate;
    });

    // 计算时间轴长度（天）
    const timeSpanDays = (maxDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24);
    const scaleFactor = 100 / (timeSpanDays || 1); // 将时间映射到 0-100 的 Z 轴范围

    milestones.forEach(m => {
        const mDate = new Date(m.milestone_date);
        const zPos = (mDate.getTime() - minDate.getTime()) / (1000 * 60 * 60 * 24) * scaleFactor; // Z 轴表示时间

        // 为每个里程碑创建一个节点
        const nodeId = m.id;
        const node = {
            id: nodeId,
            label: m.title,
            type: m.milestone_type,
            date: m.milestone_date,
            url: m.source_url,
            summary: m.summary,
            // 简单模拟 x, y 坐标，可以根据类型或随机生成
            x: (Math.random() - 0.5) * 20,
            y: (Math.random() - 0.5) * 20,
            z: zPos,
            size: 3 + (m.milestone_type === 'Key Patent' ? 2 : 0), // 专利可能大一点
            color: m.milestone_type === 'Pioneering Paper' ? '#FFD700' : (m.milestone_type === 'Key Patent' ? '#ADD8E6' : '#90EE90')
        };
        nodes.push(node);
        nodeMap.set(nodeId, node);
    });

    // 创建时间顺序上的边
    for (let i = 0; i < nodes.length - 1; i++) {
        edges.push({
            source: nodes[i].id,
            target: nodes[i+1].id,
            type: '时间顺序',
            strength: 1
        });
    }
    
    Logger.log(`[${jobName}] 数据准备完毕。节点数: ${nodes.length}, 边数: ${edges.length}`);
    return { nodes, edges };
  },

  /**
   * [API] 为前端演进分析图表 (Evolution Trajectory) 提供数据。
   * 匹配 mock_api.js -> AnalysisService.getEvolutionData
   * @param {string} entityId - 实体ID (可以是技术或公司)
   * @returns {object} { trendData: [{date, influence, attention}], timelineEvents: [{date, lane, title, description}] }
   */
  getEvolutionTimelineData: function(entityId) {
    const jobName = `EvolutionTimeline for ${entityId}`;
    Logger.log(`[${jobName}] 开始准备演进时间线数据...`);

    // 获取实体本身的AI评分
    const entity = DataService.getDocument('REG_ENTITIES', entityId);
    if (!entity) {
        Logger.log(`[${jobName}] Entity ${entityId} not found.`);
        return { trendData: [], timelineEvents: [] };
    }

    // --- trendData (影响力/关注度趋势) ---
    // 从 ANL_DAILY_SNAPSHOTS 获取快照数据
    const snapshots = DataService.getDataAsObjects('ANL_DAILY_SNAPSHOTS', {
        filters: [{ field: 'entity_id', operator: 'EQUAL', value: entityId }],
        orderBy: { field: 'snapshot_date', direction: 'ASCENDING' },
        limit: 365 // 获取最近一年的数据
    }) || [];

    const trendData = snapshots.map(s => ({
        date: DateUtils.formatDate(s.snapshot_date), // YYYY-MM-DD
        influence: s.influence_score || 0,
        attention: s.market_attention_score || 0
    }));

    // --- timelineEvents (关键事件) ---
    // 从 FND_MASTER 获取与该实体相关的、被标记为重要（例如信号强度高）的发现
    const timelineFindings = DataService.getDataAsObjects('FND_MASTER', {
        filters: [
            { field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: entityId },
            { field: 'signal_strength_score', operator: 'GREATER_THAN_OR_EQUAL', value: 7 } // 信号强度7以上视为重要事件
        ],
        orderBy: { field: 'publication_timestamp', direction: 'DESCENDING' },
        limit: 10 // 获取最近的10个重要事件
    }) || [];

    const timelineEvents = timelineFindings.map(f => {
        const laneMap = {
            'TECH_NEWS': '市场', 'INDUSTRY_DYNAMICS': '市场',
            'ACADEMIC_PAPER': '技术', 'PATENT': '技术', 'OPENSOURCE': '技术',
            'TALENT_FLOW': '人才', 'ANALYST_REPORT': '市场', 'CORPORATE_FILING': '市场'
        };
        const lane = laneMap[f.task_type] || '其他';

        return {
            date: DateUtils.formatDate(f.publication_timestamp || f.created_timestamp),
            lane: lane,
            title: f.title,
            description: f.ai_summary || f.summary
        };
    });

    Logger.log(`[${jobName}] 数据准备完毕。趋势数据点: ${trendData.length}, 时间线事件: ${timelineEvents.length}`);
    return { trendData, timelineEvents };
  }
};
