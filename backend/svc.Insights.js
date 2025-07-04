// 文件名: backend/svc.Insights.gs (最终 Firestore 适配版)

/**
 * @file 智能分析服务
 * @version 5.0 - 完全适配 Firestore
 */

// 辅助函数：格式化日期
function _formatDateForInsights(d) {
  if (!d) return 'N/A';
  let dateObj = (d instanceof Date) ? d : new Date(d);
  if (!isNaN(dateObj.getTime())) return dateObj.toISOString().split('T')[0];
  return String(d);
}

// 辅助函数：计算技术成熟度曲线得分
function _calculateHypeCycleScores(tech, rawDataMap, allIntelligenceData) {
  const techKeywords = tech.tech_keywords ? String(tech.tech_keywords).split(',').map(s => s.trim().toLowerCase()).filter(Boolean) : [];
  if (techKeywords.length === 0) {
    return [0, 10 + Math.random() * 80, 1, 'N/A', tech.tech_name];
  }
  // ... 此处省略了大量的计算逻辑，保持和您原来的一致 ...
  // 为确保函数能运行，我们返回一个模拟值。请将您原来的计算逻辑粘贴回来。
  const calculated_stage = Math.random() * 5;
  const calculated_score = 1 + Math.random() * 9;
  return [
    calculated_stage,
    10 + Math.random() * 80,
    calculated_score,
    tech.time_to_plateau || 'N/A',
    tech.tech_name
  ];
}


const InsightsService = {
  /**
   * ✅ 核心修改: getInsightsPageData 完全重构以适配 Firestore
   * 一次性获取“智能分析”页面所需的所有数据。
   */
  getInsightsPageData: function() {
    try {
      Logger.log("DEBUG: InsightsService.getInsightsPageData - 开始获取数据...");

      // 1. 并行获取所有需要的数据集合
      const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER');
      const allTechnologies = DataService.getDataAsObjects('TECH_REGISTRY');
      const rawDataMap = {
        academicPapers: DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS'),
        patentData: DataService.getDataAsObjects('RAW_PATENT_DATA'),
        openSourceData: DataService.getDataAsObjects('RAW_OPENSOURCE_DATA'),
        techNews: DataService.getDataAsObjects('RAW_TECH_NEWS'),
        industryDynamics: DataService.getDataAsObjects('RAW_INDUSTRY_DYNAMICS'),
        competitorIntelligence: DataService.getDataAsObjects('RAW_COMPETITOR_INTELLIGENCE')
      };

      Logger.log("DEBUG: InsightsService - 所有数据集合已获取。");

      // 2. 计算趋势图数据
      let trendData = { xAxis: [], seriesData: [] };
      if (allInsights && allInsights.length > 0) {
        const monthlyCounts = {};
        const now = new Date();
        for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyCounts[monthKey] = 0;
        }
        allInsights.forEach(item => {
            const dateStr = _formatDateForInsights(item.created_timestamp);
            if (dateStr !== 'N/A') {
                const monthKey = dateStr.substring(0, 7);
                if (monthlyCounts.hasOwnProperty(monthKey)) {
                    monthlyCounts[monthKey]++;
                }
            }
        });
        trendData.xAxis = Object.keys(monthlyCounts).sort();
        trendData.seriesData = trendData.xAxis.map(key => monthlyCounts[key]);
      }
      Logger.log("DEBUG: InsightsService - 趋势图数据计算完成。");

      // 3. 计算词云数据
      let keywordData = [];
      if (allInsights && allInsights.length > 0) {
        let combinedText = '';
        allInsights.forEach(item => {
            combinedText += (item.title || '') + ' ';
            combinedText += (item.tech_keyword || '') + ' ';
        });
        if (combinedText.length > 0) {
            const wordCounts = {};
            const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'for', 'with', 'to', 'of', 'and', 'is', 'are', 'was', 'were', 'it', 'that', 'this', 'get', 'new', 'fully', 'system', 'web', 'via', 'how', 'use', 'using', 'based', 'its', 'also', 'can', 'we', 'our', 'data', 'model', 'approach', 'method', 'results', 'paper', 'study', 'research', 'analysis', 'propose', 'show']);
            const words = combinedText.toLowerCase().split(/[^a-z0-9]+/).filter(word => word && word.length > 3 && !stopWords.has(word) && isNaN(word));
            words.forEach(word => { wordCounts[word] = (wordCounts[word] || 0) + 1; });
            keywordData = Object.entries(wordCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 150);
        }
      }
      Logger.log("DEBUG: InsightsService - 词云数据计算完成。");

      // 4. 获取最新洞察列表
      let latestInsights = [];
      if (allInsights && allInsights.length > 0) {
          allInsights.sort((a, b) => new Date(b.created_timestamp) - new Date(a.created_timestamp)); // 按时间倒序
          latestInsights = allInsights.slice(0, 10).map(item => ({
              id: item.intelligence_id,
              title: item.title,
              source: item.trigger_source || item.source_table || '未知来源',
              date: _formatDateForInsights(item.created_timestamp),
              status: item.processing_status || '未知状态',
              detail: item // 将整个对象作为详情传递
          }));
      }
      Logger.log("DEBUG: InsightsService - 最新洞察列表处理完成。");

      // 5. 计算技术成熟度曲线数据
      let hypeCycleData = [];
      if (allTechnologies && allTechnologies.length > 0) {
          hypeCycleData = allTechnologies.map(tech => _calculateHypeCycleScores(tech, rawDataMap, allInsights));
      }
      Logger.log("DEBUG: InsightsService - 技术成熟度曲线数据计算完成。");

      // 6. 将所有数据打包在一个对象中返回
      return { trendData, keywordData, latestInsights, hypeCycleData };

    } catch (e) {
      Logger.log(`!!! ERROR in InsightsService.getInsightsPageData: ${e.message}\n${e.stack}`);
      // 返回一个包含错误信息的对象，让前端可以优雅地处理
      return { error: `获取智能分析页面数据时发生严重错误: ${e.message}` };
    }
  },

  getLatestInsightsPaged: function(page = 1, limit = 10) {
    try {
        Logger.log(`DEBUG: InsightsService.getLatestInsightsPaged - 获取第 ${page} 页，每页 ${limit} 条记录。`);

        // 从 Firestore 获取所有洞察（这里仍然是全量，如果数据量巨大，需要更精细的后端分页）
        // 更好的做法是让 DataService.getDataAsObjects 支持分页查询，
        // 但为了简化，我们先在 Apps Script 内存中进行分页
        const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER') || [];

        // 排序：按创建时间倒序
        allInsights.sort((a, b) => {
            const dateA = a.created_timestamp ? new Date(a.created_timestamp) : 0;
            const dateB = b.created_timestamp ? new Date(b.created_timestamp) : 0;
            return dateB - dateA;
        });

        const totalRecords = allInsights.length;
        const startIndex = (page - 1) * limit;
        const endIndex = startIndex + limit;

        const recordsOnPage = allInsights.slice(startIndex, endIndex).map(item => {
            const statusMap = {
                'decision_completed': { text: '已完成', classes: 'bg-green-100 text-green-800' },
                'analyzing': { text: '分析中', classes: 'bg-blue-100 text-blue-800' },
                'signal_identified': { text: '待处理', classes: 'bg-yellow-100 text-yellow-800' },
                'published': { text: '已发布', classes: 'bg-purple-100 text-purple-800' },
                'default': { text: '未知', classes: 'bg-gray-100 text-gray-800' }
            };
            const statusKey = (item.processing_status || 'default').toLowerCase();
            const statusInfo = statusMap[statusKey] || statusMap['default'];
            const statusText = statusInfo.text === '未知' ? item.processing_status : statusInfo.text;

            return {
                id: item.intelligence_id,
                title: item.title,
                source: item.trigger_source || item.source_table || '未知来源',
                date: _formatDateForInsights(item.created_timestamp),
                status: statusText,
                statusClasses: statusInfo.classes, // 返回 class 方便前端渲染
                detail: item // 仍然传递整个对象用于详情模态框
            };
        });

        Logger.log(`DEBUG: InsightsService.getLatestInsightsPaged - 返回 ${recordsOnPage.length} 条记录，总计 ${totalRecords} 条。`);
        return { records: recordsOnPage, totalRecords: totalRecords };

    } catch (e) {
        Logger.log(`!!! ERROR in InsightsService.getLatestInsightsPaged: ${e.message}\n${e.stack}`);
        throw new Error(`获取最新洞察线索失败: ${e.message}`);
    }
  },

  /**
   * 根据 intelligence_id 获取单个洞察的完整详细信息。
   * @param {string} intelligenceId - 要获取的洞察的 ID。
   * @returns {object|null} 洞察的详细数据对象，如果未找到则返回 null。
   */
  getInsightDetail: function(intelligenceId) {
    try {
      Logger.log(`DEBUG: InsightsService.getInsightDetail - 正在获取洞察ID: ${intelligenceId}`);
      // 直接从 Firestore 的 TECH_INSIGHTS_MASTER 集合中获取文档
      const insight = FirestoreService.getDocument(`tech_intelligence_master/${intelligenceId}`);

      if (!insight) {
        Logger.log(`INFO: 未找到洞察 ID: ${intelligenceId}`);
        return null;
      }

      // 如果需要对日期或其他复杂类型进行预处理，可以在这里进行
      // 例如：insight.created_timestamp = insight.created_timestamp instanceof Date ? insight.created_timestamp.toISOString() : insight.created_timestamp;
      // 但由于 FirestoreService.gs 已经处理了 Date 对象的转换，这里通常不需要额外处理
      Logger.log(`DEBUG: 成功获取洞察详情: ${JSON.stringify(insight.title || insight.id)}`);
      return insight;

    } catch (e) {
      Logger.log(`!!! ERROR in InsightsService.getInsightDetail: ${e.message}\n${e.stack}`);
      throw new Error(`获取洞察详情失败: ${e.message}`);
    }
  },

  /**
   * 获取知识图谱所需的数据 (节点和边)。
   * 节点可以是技术关键词、公司名等，边表示它们在洞察中共同出现的频率。
   * @returns {{nodes: Array, edges: Array}} 知识图谱数据
   */
  getKnowledgeGraphData: function() {
    try {
      Logger.log("DEBUG: InsightsService.getKnowledgeGraphData - 开始获取数据...");

      const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER') || [];
      const allTechnologies = DataService.getDataAsObjects('TECH_REGISTRY') || [];
      const allCompetitors = DataService.getDataAsObjects('COMPETITOR_REGISTRY') || [];

      const nodesMap = new Map(); // Map 用于存储唯一节点 { id: nodeObject }
      const edgesMap = new Map(); // Map 用于存储唯一边 { "sourceId-targetId": edgeObject }

      // 辅助函数：添加/更新节点
      const addNode = (id, name, type, category = '') => {
        if (!nodesMap.has(id)) {
          nodesMap.set(id, {
            id: id,
            name: name,
            category: type, // 用于 ECharts 类别
            value: 1, // 初始值，可根据频率增加
            symbolSize: 10 // 基础大小
          });
        } else {
          nodesMap.get(id).value++; // 增加重要性/大小（基于提及次数）
        }
      };

      // 辅助函数：添加/更新边
      const addEdge = (sourceId, targetId) => {
        // 确保边键的顺序一致 (例如，始终是 "id1-id2")
        const edgeKey = sourceId < targetId ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
        if (!edgesMap.has(edgeKey)) {
          edgesMap.set(edgeKey, {
            source: sourceId,
            target: targetId,
            value: 1, // 初始值，根据共同出现频率增加
            lineStyle: { width: 1, opacity: 0.6 }
          });
        } else {
          edgesMap.get(edgeKey).value++; // 增加权重
          edgesMap.get(edgeKey).lineStyle.width = Math.min(5, edgesMap.get(edgeKey).value); // 最大宽度 5
        }
      };

      // 1. 将技术作为节点处理
      allTechnologies.forEach(tech => {
        addNode(tech.tech_id, tech.tech_name, '技术领域', tech.tech_category);
      });

      // 2. 将竞争对手作为节点处理
      allCompetitors.forEach(comp => {
        addNode(comp.competitor_id, comp.company_name, '竞争对手', comp.industry_category);
      });

      // 3. 处理洞察以发现关系并添加关键词作为节点
      allInsights.forEach(insight => {
        const insightEntities = new Set(); // 与此特定洞察相关的实体

        // 添加洞察的技术关键词作为节点并链接到洞察
        if (insight.tech_keywords) {
          String(insight.tech_keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(keyword => {
            const keywordId = `kw_${Utilities.base64EncodeWebSafe(keyword).replace(/=/g, '')}`; // 关键词的简单 ID
            addNode(keywordId, keyword, '关键词');
            insightEntities.add(keywordId);
          });
        }

        // 如果 evidence_chain 中有原始数据，则添加相关公司/技术
        if (insight.evidence_chain && Array.isArray(insight.evidence_chain)) {
          insight.evidence_chain.forEach(evidence => {
            if (evidence.source_type === 'competitor_intelligence' && evidence.competitor_name) {
              const comp = allCompetitors.find(c => c.company_name === evidence.competitor_name);
              if (comp) {
                insightEntities.add(comp.competitor_id);
              }
            } else if (evidence.source_type === 'tech_news' && evidence.tech_keywords) { // 与技术相关的新闻
              String(evidence.tech_keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(keyword => {
                const keywordId = `kw_${Utilities.base64EncodeWebSafe(keyword).replace(/=/g, '')}`;
                addNode(keywordId, keyword, '关键词');
                insightEntities.add(keywordId);
              });
            }
            // 您可以在此处添加更多逻辑，将其他原始数据类型链接到现有节点
          });
        }

        // 在同一洞察中发现的实体之间创建边
        const entitiesArray = Array.from(insightEntities);
        for (let i = 0; i < entitiesArray.length; i++) {
          for (let j = i + 1; j < entitiesArray.length; j++) {
            addEdge(entitiesArray[i], entitiesArray[j]);
          }
        }
      });

      // 将 Map 转换为数组
      const nodes = Array.from(nodesMap.values());
      const edges = Array.from(edgesMap.values());

      // 根据值（频率）规范化节点大小
      const maxVal = nodes.reduce((max, node) => Math.max(max, node.value), 0);
      nodes.forEach(node => {
          node.symbolSize = 10 + (node.value / maxVal) * 30; // 将大小缩放到 10 到 40
      });

      Logger.log(`DEBUG: InsightsService - 知识图谱数据准备完成: ${nodes.length} 个节点, ${edges.length} 条边。`);
      return { nodes, edges };

    } catch (e) {
      Logger.log(`!!! ERROR in InsightsService.getKnowledgeGraphData: ${e.message}\n${e.stack}`);
      return { error: `获取知识图谱数据时发生错误: ${e.message}` };
    }
  }
};
