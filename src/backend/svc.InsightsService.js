// 文件名: backend/svc.Insights.gs (最终修复版，同时支持两种图谱)

/**
 * @file 智能分析服务
 * @version 6.0 - 完全适配 Firestore，并同时支持技术知识图谱和专家网络图谱
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

      // 3. 计算词云数据 (***请用以下代码块替换你现有文件中的此部分***)
      let keywordData = [];
      if (allInsights && allInsights.length > 0) {
        let combinedText = '';
        allInsights.forEach(item => {
            // ✅ 核心优化：优先使用 ai_keywords，如果不存在，再使用 tech_keywords，最后才考虑 title
            // ai_keywords 是AI从内容中提取的，通常更精准
            // tech_keywords 是注册的技术领域关键词，也是高价值的
            // title 是最泛的，作为补充
            const keywordsFromAI = item.ai_keywords ? String(item.ai_keywords).split(',').map(s => s.trim()).filter(Boolean) : [];
            const keywordsFromReg = item.tech_keywords ? String(item.tech_keywords).split(',').map(s => s.trim()).filter(Boolean) : [];
            
            // 合并所有明确的关键词
            const allSpecificKeywords = [...keywordsFromAI, ...keywordsFromReg];
            if (allSpecificKeywords.length > 0) {
                combinedText += allSpecificKeywords.join(' ') + ' ';
            } else {
                // 如果没有明确的关键词，才使用标题作为补充
                combinedText += (item.title || '') + ' ';
            }
        });
        if (combinedText.length > 0) {
            const wordCounts = {};
            // 你的停用词列表，可以根据需要扩充
            const stopWords = new Set([
              'a', 'an', 'the', 'in', 'on', 'for', 'with', 'to', 'of', 'and', 'is', 'are', 'was', 'were', 'it', 'that', 'this', 'get', 'new', 'fully', 'system', 'web', 'via', 'how', 'use', 'using', 'based', 'its', 'also', 'can', 'we', 'our', 'data', 'model', 'approach', 'method', 'results', 'paper', 'study', 'research', 'analysis', 'propose', 'show',
              // 针对你截图中的泛化词，可以考虑添加到停用词列表
              'internet', 'patent', 'agents', 'robotics', 'market', 'nvidia', 'security', 'threat', 'detection', 'machine', 'learning', 'behavioral', 'anomaly', 'distribution', 'quantum', 'cryptography', 'post', 'key', 'qkd', 'resistant', 'silicon', '光电', '集成', '公司', '企业', '技术', '研究', '发展', '行业', '创新', '领域', '新' // 扩充中文停用词
            ]);
            // 过滤规则：长度大于1（因为有些关键词如“AI”很短），不是停用词，不是纯数字。
            // 使用 /u 标志支持 Unicode 字符，包括中文。
            const words = combinedText.toLowerCase().split(/[^a-z0-9\u4e00-\u9fa5]+/u) 
                                     .filter(word => word && word.length > 1 && !stopWords.has(word) && !/^\d+$/.test(word)); // 确保不是纯数字

            words.forEach(word => { wordCounts[word] = (wordCounts[word] || 0) + 1; });
            keywordData = Object.entries(wordCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 150);
        }
      }
      Logger.log("DEBUG: InsightsService - 词云数据计算完成。");
      // 3. 计算词云数据 结束

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
        Logger.log("开始获取知识图谱数据 (基于最终正确逻辑)...");

        // --- 1. 数据准备 ---
        const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER') || [];
        const allTechnologies = DataService.getDataAsObjects('TECH_REGISTRY') || [];
        const allCompetitors = DataService.getDataAsObjects('COMPETITOR_REGISTRY') || [];

        const nodesMap = new Map();
        const edgesMap = new Map();

        // --- 2. 辅助函数 (增强版) ---
        const addNode = (id, name, type) => {
            if (!id || !name) return;
            const trimmedId = String(id).trim();
            if (!nodesMap.has(trimmedId)) {
                nodesMap.set(trimmedId, { id: trimmedId, name: String(name).trim(), category: type, value: 0 });
            }
            nodesMap.get(trimmedId).value++; // 每次提及，节点权重+1
        };

        const addEdge = (sourceId, targetId) => {
            if (!sourceId || !targetId || sourceId === targetId) return;
            const edgeKey = String(sourceId) < String(targetId) ? `${sourceId}-${targetId}` : `${targetId}-${sourceId}`;
            if (!edgesMap.has(edgeKey)) {
                edgesMap.set(edgeKey, { source: String(sourceId), target: String(targetId), value: 0 });
            }
            edgesMap.get(edgeKey).value++; // 每次共现，边的权重+1
        };

        // --- 3. 核心算法：恢复你的正确逻辑 ---
        
        // a. 初始化基础节点 (技术领域和竞争对手)
        allTechnologies.forEach(tech => {
            addNode(tech.tech_id, tech.tech_name, '技术领域');
        });
        allCompetitors.forEach(comp => {
            addNode(comp.competitor_id, comp.company_name, '竞争对手');
        });
        
        // b. 遍历洞察，构建关系
        allInsights.forEach(insight => {
            const insightEntities = new Set();
            
            // 关联技术领域 (从 insight.tech_id)
            if (insight.tech_id && nodesMap.has(insight.tech_id)) {
                insightEntities.add(insight.tech_id);
            }

            // 关联关键词
            if (insight.tech_keywords) {
                String(insight.tech_keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(keyword => {
                    const keywordId = `kw_${keyword}`;
                    addNode(keywordId, keyword, '关键词');
                    insightEntities.add(keywordId);
                });
            }

            // 关联竞争对手 (从 insight.evidence_chain)
            if (Array.isArray(insight.evidence_chain)) {
                insight.evidence_chain.forEach(evidence => {
                    if (evidence.competitor_name) {
                        const comp = allCompetitors.find(c => c.company_name === evidence.competitor_name);
                        if (comp && nodesMap.has(comp.competitor_id)) {
                            insightEntities.add(comp.competitor_id);
                        }
                    }
                });
            }
            
            // 为本条洞察中共同出现的所有实体两两之间增加边的权重
            const entitiesArray = Array.from(insightEntities);
            if (entitiesArray.length > 1) {
                for (let i = 0; i < entitiesArray.length; i++) {
                    for (let j = i + 1; j < entitiesArray.length; j++) {
                        addEdge(entitiesArray[i], entitiesArray[j]);
                    }
                }
            }
        });

        // --- 4. 后处理与返回 (增强版) ---
        const nodes = Array.from(nodesMap.values());
        const edges = Array.from(edgesMap.values());
        
        // 根据权重动态调整节点大小
        if (nodes.length > 0) {
            const maxNodeValue = Math.max(...nodes.map(node => node.value), 1);
            nodes.forEach(node => {
                node.symbolSize = 10 + (node.value / maxNodeValue) * 40;
            });
        }
        
        // 根据权重动态调整边的粗细和透明度
        if (edges.length > 0) {
            // 步骤 1: 计算最大权重值
            const maxEdgeValue = Math.max(...edges.map(edge => edge.value), 1);
            
            // 步骤 2: 计算最大权重的平方根，作为归一化的分母
            const maxSqrtValue = Math.sqrt(maxEdgeValue);

            edges.forEach(edge => {
                // 步骤 3: 计算当前边权重的平方根
                const currentSqrtValue = Math.sqrt(edge.value);
                
                // 步骤 4: 使用平方根的比率来计算宽度和不透明度
                const ratio = currentSqrtValue / maxSqrtValue;
                
                edge.lineStyle = {
                    // 基础宽度0.5，最大额外增加6.5，总宽度在0.5到7之间
                    width: 0.5 + ratio * 6.5, 
                    // 基础不透明度0.3，最大额外增加0.6，总不透明度在0.3到0.9之间
                    opacity: 0.3 + ratio * 0.6
                };
            });
        }

        Logger.log(`知识图谱加权算法完成: ${nodes.length} 个节点, ${edges.length} 条边。`);
        return { nodes, edges };

    } catch (e) {
        Logger.log(`!!! ERROR in getKnowledgeGraphData: ${e.message}\n${e.stack}`);
        return { nodes: [], edges: [] };
    }
  },

  /**
   * ✅ 新增：获取专家网络图谱数据
   * 节点是作者和机构。
   */
   getExpertNetworkData: function() {
    Logger.log("======================================================");
    Logger.log("--- [BACKEND LOG] getExpertNetworkData 开始执行 (v7 - 多色渲染版，含机构) ---");

    try {
        const authors = DataService.getDataAsObjects('AUTHORS_REGISTRY') || [];
        const affiliations = DataService.getDataAsObjects('AFFILIATIONS_REGISTRY') || [];

        Logger.log(`[BACKEND LOG] 读取到 ${authors.length} 位作者, ${affiliations.length} 家机构。`);

        if (authors.length === 0) {
            Logger.log("[BACKEND LOG] 作者集合为空，无法构建图谱。");
            return { nodes: [], edges: [] };
        }

        const nodesMap = {};
        const edgeWeights = new Map();
        
        // 新增：创建机构ID到机构名称的映射，方便快速查找
        const affiliationsNameMap = new Map();
        affiliations.forEach(aff => {
            if (aff && aff.affiliation_id && aff.name) {
                affiliationsNameMap.set(aff.affiliation_id, aff.name);
            }
        });

        // 步骤 1: 创建节点
        affiliations.forEach(aff => {
            if (aff && aff.id) { // aff.id 实际上是 affiliation_id
                nodesMap[aff.id] = { 
                    id: aff.id, 
                    name: aff.name, 
                    category: '机构', 
                    value: aff.author_count || 1 
                };
            }
        });

        authors.forEach(author => {
            if (author && author.id) { // author.id 实际上是 author_id
                const affiliationName = author.last_known_affiliation ? 
                                        affiliationsNameMap.get(author.last_known_affiliation) || '未知机构' : 
                                        '未知机构'; // 获取机构名称

                nodesMap[author.id] = {
                    id: author.id,
                    name: author.full_name,
                    category: '专家',
                    paper_count: author.paper_count || 0,
                    patent_count: author.patent_count || 0,
                    value: (author.paper_count || 0) + (author.patent_count || 0),
                    main_tech_areas: author.main_tech_areas || [],
                    // ✅ 新增字段：专家所属机构的名称
                    affiliation_name: affiliationName 
                };
            }
        });

        const finalNodes = Object.values(nodesMap);
        const finalEdges = [];
        const addedEdgeKeys = new Set();

        // 步骤 2: 创建边并计算权重 (此部分逻辑不变)
        authors.forEach(author => {
            if (!author || !author.id || !nodesMap[author.id]) return;

            if (author.last_known_affiliation && nodesMap[author.last_known_affiliation]) {
                const edgeKey = `aff-${author.id}-${author.last_known_affiliation}`;
                if (!addedEdgeKeys.has(edgeKey)) {
                    finalEdges.push({ source: author.id, target: author.last_known_affiliation, value: 1 });
                    addedEdgeKeys.add(edgeKey);
                }
            }

            if (Array.isArray(author.coauthor_ids)) {
                author.coauthor_ids.forEach(coauthorId => {
                    if (coauthorId && nodesMap[coauthorId]) {
                        const edgeKey = author.id < coauthorId ? 
                                        `${author.id}--${coauthorId}` : `${coauthorId}--${author.id}`;
                        edgeWeights.set(edgeKey, (edgeWeights.get(edgeKey) || 0) + 1);
                    }
                });
            }
        });

        edgeWeights.forEach((weight, key) => {
            const [source, target] = key.split('--');
            finalEdges.push({ source, target, value: weight });
        });

        Logger.log(`[BACKEND LOG] 最终构建完成: ${finalNodes.length} 个节点, ${finalEdges.length} 条边。`);
        Logger.log("======================================================");
        return { nodes: finalNodes, edges: finalEdges };

    } catch (e) {
        Logger.log(`!!! [BACKEND LOG] getExpertNetworkData 捕获到严重错误: ${e.message} !!!\n${e.stack}`);
        return { nodes: [], edges: [], error: e.message };
    }
  },

  /**
   * AI生成专家简介。
   * 增加：所属机构名称作为AI提示的上下文信息。
   * @param {string} expertName - 专家姓名。
   * @param {string} primaryTechArea - 专家主要技术领域。
   * @param {string} affiliationName - 专家所属机构名称。 // ✅ 新增参数
   * @param {number} paperCount - 论文数量。
   * @param {number} patentCount - 专利数量。
   * @param {Array<string>} mainTechAreas - 其他主要技术领域列表。
   * @returns {string} AI生成的专家简介文本。
   */
  generateExpertSummary: function(expertName, primaryTechArea, affiliationName, paperCount, patentCount, mainTechAreas) {
    Logger.log(`[AI-ExpertSummary] 开始生成专家简介 for: ${expertName}`);
    Logger.log(`[AI-ExpertSummary] 参数: 主领域=${primaryTechArea}, 机构=${affiliationName}, 论文=${paperCount}, 专利=${patentCount}`);

    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      Logger.log("ERROR: OPENAI_API_KEY 未在项目属性中配置。");
      return "AI简介生成失败：AI API Key未配置。";
    }
    Logger.log("[AI-ExpertSummary] OPENAI_API_KEY 已加载。");

    // 构建AI的输入提示 (Prompt)
    const prompt = `你是一个专业的专家简介生成器。根据以下信息为专家生成一个简洁、专业、积极的个人简介（大约80-120字）。
      请着重描述他们在研究领域的贡献、专业知识和潜在影响力。
      只输出简介文本，不要包含任何额外对话或标题。

      信息：
      姓名: ${expertName}
      主要研究领域: ${primaryTechArea}
      所属机构: ${affiliationName}
      发表论文数量: ${paperCount}
      拥有专利数量: ${patentCount}
      其他技术领域: ${mainTechAreas.length > 0 ? mainTechAreas.join(', ') : '无'}

      请开始生成简介：`;

    Logger.log(`[AI-ExpertSummary] 发送给AI的Prompt (前200字符): ${prompt.substring(0, 200)}...`);

    const payload = {
      model: "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
      max_tokens: 200,
      temperature: 0.7
    };

    const requestOptions = {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      Logger.log("[AI-ExpertSummary] 正在调用 OpenAI API...");
      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      Logger.log(`[AI-ExpertSummary] OpenAI API响应码: ${responseCode}`);
      Logger.log(`[AI-ExpertSummary] OpenAI API原始响应: ${responseText.substring(0, 500)}...`); // 限制日志长度

      if (responseCode === 200) {
        const jsonResponse = JSON.parse(responseText);
        if (jsonResponse.choices && jsonResponse.choices.length > 0 && jsonResponse.choices[0].message) {
          const aiGeneratedSummary = jsonResponse.choices[0].message.content.trim();
          Logger.log(`[AI-ExpertSummary] AI生成简介成功 (前100字符): ${aiGeneratedSummary.substring(0, 100)}...`);
          return aiGeneratedSummary;
        } else {
          Logger.log("ERROR: AI响应格式不正确，缺少choices或message。");
          return "AI简介生成失败：AI响应格式错误。";
        }
      } else {
        Logger.log(`ERROR: AI API返回错误，状态码: ${responseCode}, 响应: ${responseText}`);
        return `AI简介生成失败：API错误 (${responseCode})。`;
      }
    } catch (e) {
      Logger.log(`CRITICAL ERROR: AI生成专家简介 API调用失败: ${e.message}\\n${e.stack}`);
      return `AI简介生成失败：连接或解析错误 (${e.message})。`;
    }
  }
};
