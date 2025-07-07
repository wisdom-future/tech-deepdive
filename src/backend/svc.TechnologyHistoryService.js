// 文件名: backend/svc.TechnologyHistoryService.gs

/**
 * @fileoverview 负责处理技术演进历史相关的数据构建与查询。
 */
const TechnologyHistoryService = {

  /**
   * 为指定技术构建或重建其发展时间轴。应由后台工作流触发。
   * @param {string} techId
   * @returns {{success: boolean, message: string}}
   */
  buildTechnologyTimeline: function(techId) {
    Logger.log(`[HistoryBuilder] 开始为技术 '${techId}' 构建时间轴...`);
    const milestones = [];
    
    const techInfo = FirestoreService.getDocument(`technology_registry/${techId}`);
    if (!techInfo) return { success: false, message: `未找到技术ID: ${techId}` };
    
    const keywords = (techInfo.tech_keywords || "").toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
    if (keywords.length === 0) return { success: false, message: `技术 '${techId}' 未配置关键词。` };

    const containsKeyword = (text) => {
      if (!text) return false;
      const lowerText = String(text).toLowerCase();
      return keywords.some(kw => lowerText.includes(kw));
    };

    const dataSources = [
      { key: 'RAW_ACADEMIC_PAPERS', type: 'Pioneering Paper', dateField: 'publication_date', titleField: 'title', authorField: 'authors', urlField: 'source_url', summaryField: 'abstract' },
      { key: 'RAW_PATENT_DATA', type: 'Key Patent', dateField: 'application_date', titleField: 'title', authorField: 'inventors', urlField: 'source_url', summaryField: 'abstract' },
      { key: 'RAW_OPENSOURCE_DATA', type: 'Major Release', dateField: 'last_commit_date', titleField: 'project_name', authorField: 'owner', urlField: 'source_url', summaryField: 'description' },
      { key: 'RAW_TECH_NEWS', type: 'News Highlight', dateField: 'publication_date', titleField: 'news_title', authorField: 'author', urlField: 'source_url', summaryField: 'news_summary' }
    ];

    dataSources.forEach(source => {
      try {
        const items = DataService.getDataAsObjects(source.key) || [];
        items.forEach(item => {
          const textToSearch = `${item[source.titleField] || ''} ${item[source.summaryField] || ''}`;
          if (containsKeyword(textToSearch)) {
            const contributors = (item[source.authorField] || "").split(',').map(name => name.trim()).filter(Boolean);
            const associated_entities = contributors.map(name => ({
              entity_id: `author_${WorkflowsService._normalizeAuthorName(name)}`,
              entity_name: name,
              entity_type: "Person"
            }));

            const milestoneDate = item[source.dateField] ? new Date(item[source.dateField]) : new Date(item.created_timestamp);
            if (isNaN(milestoneDate.getTime())) return;

            const milestone = {
              milestone_id: `MSTONE_${techId}_${milestoneDate.getTime()}_${Utilities.getUuid().substring(0,4)}`,
              tech_id: techId,
              milestone_date: milestoneDate,
              milestone_type: source.type,
              title: item[source.titleField],
              summary: item.ai_summary || String(item[source.summaryField] || '').substring(0, 300),
              source_url: item[source.urlField],
              source_document_id: item.id,
              associated_entities: associated_entities,
              created_timestamp: new Date()
            };
            milestones.push(milestone);
          }
        });
      } catch(e) {
        Logger.log(`扫描集合 ${source.key} 时出错: ${e.message}`);
      }
    });
    
    if (milestones.length > 0) {
      DataService.batchUpsert('TECH_EVOLUTION_MILESTONES', milestones, 'milestone_id');
    }

    return { success: true, message: `为 ${techId} 成功构建了 ${milestones.length} 个里程碑。` };
  },

  /**
   * [API] 为前端 "技术时空锥" 可视化准备数据。
   * @param {string} techId
   * @returns {{nodes: Array<Object>, edges: Array<Object>}}
   */
  getTechnologySpacetimeConeData: function(techId) {
    Logger.log(`[SpacetimeCone] 开始为技术 '${techId}' 准备时空锥数据...`);

    const allMilestones = FirestoreService.queryCollection('tech_evolution_milestones');
    const milestones = allMilestones.filter(m => m.tech_id === techId);

    if (!milestones || milestones.length === 0) {
      return { nodes: [], edges: [] };
    }

    milestones.sort((a, b) => new Date(a.milestone_date) - new Date(b.milestone_date));

    const nodes = [];
    const edges = [];
    
    const dates = milestones.map(m => new Date(m.milestone_date).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const dateRange = maxDate - minDate || 1;

    const categoryCoordinates = {
      'Pioneering Paper': { x: -80, y: 80, color: '#4285F4' },
      'Key Patent':       { x: -40, y: -60, color: '#34A853' },
      'Major Release':    { x: 40, y: -60, color: '#FBBC05' },
      'News Highlight':   { x: 80, y: 80, color: '#EA4335' },
      'default':          { x: 0, y: 0, color: '#9E9E9E' }
    };
    
    milestones.forEach(m => {
      const coords = categoryCoordinates[m.milestone_type] || categoryCoordinates['default'];
      const z = -150 * ((new Date(m.milestone_date).getTime() - minDate) / dateRange);
      const size = 4 + (m.associated_entities ? m.associated_entities.length : 0);

      nodes.push({
        id: m.source_document_id,
        label: m.title,
        date: m.milestone_date,
        type: m.milestone_type,
        details: m.summary,
        url: m.source_url,
        x: coords.x + (Math.random() - 0.5) * 30,
        y: coords.y + (Math.random() - 0.5) * 30,
        z: z,
        size: size,
        color: coords.color
      });
    });

    for (let i = 0; i < milestones.length; i++) {
      for (let j = i + 1; j < milestones.length; j++) {
        const eventA = milestones[i];
        const eventB = milestones[j];
        if (this._haveCommonTerms(eventA.title, eventB.title)) {
           edges.push({
             source: eventA.source_document_id,
             target: eventB.source_document_id
           });
        }
      }
    }
    
    Logger.log(`[SpacetimeCone] 数据准备完毕。节点数: ${nodes.length}, 边数: ${edges.length}`);
    return { nodes, edges };
  },

  _haveCommonTerms: function(strA, strB) {
      if (!strA || !strB) return false;
      const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'for', 'of', 'with', 'to', 'is', 'are', 'and', 'or', 'new', 'system', 'model']);
      const wordsA = new Set(String(strA).toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 3 && !stopWords.has(w)));
      if (wordsA.size === 0) return false;
      const wordsB = String(strB).toLowerCase().split(/[\s,.-]+/).filter(w => w.length > 3 && !stopWords.has(w));
      return wordsB.some(word => wordsA.has(word));
  }
};

// 文件名: backend/svc/TechnologyHistoryService.gs

function runManualTimelineBuilder() {
  try {
    // ▼▼▼ 将ID修改为截图中的目标ID ▼▼▼
    const targetTechId = "CS003"; 
    // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

    Logger.log(`--- 开始为技术 [${targetTechId}] 手动构建时间轴 ---`);
    
    // ... 函数其余部分保持不变 ...
    const result = TechnologyHistoryService.buildTechnologyTimeline(targetTechId);
    
    Logger.log(`--- 构建完成 ---`);
    Logger.log(`结果: ${result.success}`);
    Logger.log(`消息: ${result.message}`);

  } catch (e) {
    Logger.log(`!!! 手动构建失败: ${e.message} !!!`);
    Logger.log(e.stack);
  }
}
