/**
 * @file layer04.ExplorationService.js
 * @description [API服务层] 探索功能数据服务。
 * 为前端“探索中心”页面提供3D星系图、信息流等功能所需的数据。
 */

const ExplorationService = {

  /**
   * [API] 获取3D星系图/时空锥数据。
   * 匹配 mock_api.js -> ExplorationService.getGalaxyMapData
   * @param {Object} options - 包含筛选条件的选项，如 { entityId }
   * @returns {Object} 包含 nodes 和 edges 的数据，用于Three.js渲染。
   */
  getGalaxyData: function(options = {}) {
    // 简化实现，直接返回所有 Company 和 Technology 实体作为节点
    // 实际应根据关系图谱 (KG_EDGES) 和影响力分数来构建更复杂的星系图
    const allEntities = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
            { compositeFilter: { op: "OR", filters: [
                { fieldFilter: { field: { fieldPath: 'entity_type' }, op: 'EQUAL', value: { stringValue: 'Company' } } },
                { fieldFilter: { field: { fieldPath: 'entity_type' }, op: 'EQUAL', value: { stringValue: 'Technology' } } }
            ]}}
        ]
    }) || [];

    const nodes = allEntities.map(e => {
        // 模拟 Mock 数据中的 x, y, z, heat, relevance, size, color
        const baseScore = e.relevance_score || e.impact_score || 50;
        const heat = Math.min(1.0, baseScore / 100 + Math.random() * 0.1);
        const relevance = Math.min(1.0, baseScore / 100 + Math.random() * 0.1);
        const size = Math.max(2, baseScore / 15); // 节点大小
        const color = e.entity_type === 'Company' ? '#0052ff' : (e.entity_type === 'Technology' ? '#28a745' : '#ffc107'); // 模拟颜色

        return {
            id: e.entity_id,
            name: e.primary_name,
            type: e.entity_type === 'Company' ? 'particle' : (e.entity_type === 'Technology' ? 'cluster' : 'particle'), // 简单模拟 cluster/particle
            category: e.entity_type,
            heat: heat,
            relevance: relevance,
            summary: e.description || '暂无摘要。',
            x: (Math.random() - 0.5) * 100, // 随机位置
            y: (Math.random() - 0.5) * 100,
            z: (Math.random() - 0.5) * 100,
            size: size,
            color: color,
            url: e.website || '#' // 如果有网站
        };
    });

    // 模拟边，可以从 KG_EDGES 中获取
    const edges = DataService.getDataAsObjects('KG_EDGES') || [];
    const mappedEdges = edges.map(r => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        strength: r.strength_score || 0.5 // 模拟强度
    }));

    return { nodes, edges: mappedEdges };
  },

  /**
   * [API] 获取指定信息流栏目的一页数据。
   * 匹配 mock_api.js -> ExplorationService.getStreamsData
   * 注意：Mock 中返回的是 grouped data (market, tech, talent, myFocus)
   * @returns {object} { market: [], tech: [], talent: [], myFocus: [] }
   */
  getStreamsData: function() {
    const result = {
        market: [],
        tech: [],
        talent: [],
        myFocus: []
    };

    // 从 FND_MASTER 获取最近的信号
    const recentFindings = DataService.getDataAsObjects('FND_MASTER', {
        orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
        limit: 20 // 获取最近的20条
    }) || [];

    recentFindings.forEach(f => {
        const item = {
            id: f.id,
            title: f.title,
            summary: f.ai_summary || f.summary,
            sourceType: DashboardService._getTaskTypeFromFinding(f), // 复用DashboardService的函数
            publicationDate: DateUtils.formatDate(f.publication_timestamp || f.created_timestamp),
            url: f.url || `#findings/${f.id}`,
            relatedEntities: (f.linked_entity_ids || []).map(id => {
                const entity = DataService.getDocument('REG_ENTITIES', id);
                return entity ? entity.primary_name : id;
            })
        };

        // 根据 signal_type 或 task_type 分类
        if (['TECH_NEWS', 'INDUSTRY_DYNAMICS'].includes(f.task_type)) {
            result.market.push(item);
        } else if (['ACADEMIC_PAPER', 'PATENT', 'OPENSOURCE'].includes(f.task_type)) {
            result.tech.push(item);
        } else if (f.task_type === 'TALENT_FLOW') {
            result.talent.push(item);
        }
        // myFocus 暂时留空，因为这个需要用户个性化数据，更复杂
    });

    return result;
  },

  /**
   * [API] 获取热门话题 (实体) 列表。
   * 匹配 mock_api.js -> ExplorationService.getPopularTopics
   * @returns {Array<Object>} [{ id, name, type }]
   */
  getPopularTopics: function() {
    // 简单实现：从 REG_ENTITIES 中获取最近被处理过且 AI 评分较高的实体
    const popularEntities = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
            { field: 'monitoring_status', operator: 'EQUAL', value: 'active' },
            { field: 'last_ai_processed_timestamp', operator: 'GREATER_THAN_OR_EQUAL', value: new Date(new Date().getTime() - 90 * 24 * 3600 * 1000) } // 3个月内活跃
        ],
        orderBy: { field: 'relevance_score', direction: 'DESCENDING' }, // 假设有这个字段
        limit: 10 // 取前10个
    }) || [];

    return popularEntities.map(e => ({
        id: e.entity_id,
        name: e.primary_name,
        type: e.entity_type
    }));
  },

  /**
   * [API] 根据话题ID获取信息流数据。
   * 匹配 mock_api.js -> ExplorationService.getFeedDataByTopics
   * @param {string[]} topics - 话题实体ID数组。
   * @returns {object} { feeds: { topicId: [items] }, relationships: [] }
   */
  getFeedDataByTopics: function(topics) {
    const feeds = {};
    const relationships = []; // 目前暂不实现关系

    if (!topics || topics.length === 0) {
        return { feeds, relationships };
    }

    topics.forEach(topicId => {
        const relatedFindings = DataService.getDataAsObjects('FND_MASTER', {
            filters: [
                { field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: topicId },
                { field: 'signal_strength_score', operator: 'GREATER_THAN_OR_EQUAL', value: 4 } // 过滤低价值信号
            ],
            orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
            limit: 5 // 每个话题取5条
        }) || [];

        feeds[topicId] = relatedFindings.map(f => ({
            id: f.id,
            title: f.title,
            summary: f.ai_summary || f.summary,
            sourceType: DashboardService._getTaskTypeFromFinding(f),
            publicationDate: DateUtils.formatDate(f.publication_timestamp || f.created_timestamp),
            url: f.url || `#findings/${f.id}`,
            relatedEntities: (f.linked_entity_ids || []).map(id => {
                const entity = DataService.getDocument('REG_ENTITIES', id);
                return entity ? entity.primary_name : id;
            })
        }));
    });

    return { feeds, relationships };
  },

  /**
   * [API] 获取实体列表，支持过滤和分页。
   * 匹配 mock_api.js -> ExplorationService.getEntities
   * @param {object} filters - 过滤条件 { type, industry, status, location, keyword }
   * @param {object} pagination - 分页信息 { page, limit }
   * @param {object} sort - 排序信息 { field, order }
   * @returns {object} { records: [], totalRecords: number }
   */
  getEntities: function(filters, pagination, sort) {
    const queryFilters = [];
    if (filters.type) { queryFilters.push({ field: 'entity_type', operator: 'EQUAL', value: filters.type }); }
    if (filters.industry) { 
        // 模糊匹配 category 或 sub_type，这里简单用包含
        // 复杂匹配可能需要 AI 语义搜索或更灵活的 Firestore 查询
        queryFilters.push({ field: 'category', operator: 'EQUAL', value: filters.industry });
    }
    if (filters.status) { queryFilters.push({ field: 'monitoring_status', operator: 'EQUAL', value: filters.status }); }
    if (filters.location) { queryFilters.push({ field: 'headquarters', operator: 'EQUAL', value: filters.location }); }
    
    // 如果有 keyword，则通过 search_keywords 进行模糊匹配 (需要后端支持数组包含查询或多次查询)
    // 假设 search_keywords 字段是数组，且 Firestore 支持 ARRAY_CONTAINS_ANY
    if (filters.keyword) {
        queryFilters.push({ field: 'search_keywords', operator: 'ARRAY_CONTAINS_ANY', value: [filters.keyword] });
    }

    const orderBy = sort && sort.field ? { field: sort.field, direction: sort.order === 'desc' ? 'DESCENDING' : 'ASCENDING' } : null;

    // 先获取所有符合过滤条件的，再进行内存分页 (如果数据量大，需要优化为 Firestore 分页)
    const allFilteredEntities = DataService.getDataAsObjects('REG_ENTITIES', { filters: queryFilters, orderBy: orderBy }) || [];

    const startIndex = (pagination.page - 1) * pagination.limit;
    const paginatedRecords = allFilteredEntities.slice(startIndex, startIndex + pagination.limit);

    // 格式化输出以匹配前端期望
    const records = paginatedRecords.map(e => ({
        id: e.entity_id,
        name: e.primary_name,
        type: e.entity_type,
        industry: e.category || 'N/A', // 映射 category 到 industry
        summary: e.description || '暂无摘要。',
        status: e.monitoring_status,
        location: e.headquarters || 'N/A',
        // microChartData: [Math.random()*100, Math.random()*100, ...], // 需要实际数据
        microChartData: [0,0,0,0,0,0,0].map(() => Math.floor(Math.random() * 100)), // 模拟
        influenceScore: e.relevance_score || e.impact_score || 50 // 模拟
    }));

    return { records: records, totalRecords: allFilteredEntities.length };
  },

  /**
   * [API] 获取单个信息流项的详细信息。
   * 匹配 mock_api.js -> ExplorationService.getFeedItemDetails
   * @param {string} feedId - 信息流项ID (通常是 FND_MASTER 或 EVD_COLLECTIONS 中的 ID)
   * @returns {object} { title, summary, sourceType, publicationDate, relatedEntities, sourceUrl }
   */
  getFeedItemDetails: function(feedId) {
    let item = DataService.getDocument('FND_MASTER', feedId);
    if (!item) {
        // 尝试从证据库中查找，如果 FND_MASTER ID 是从证据库直接来的
        const collectionKeys = ['EVD_NEWS', 'EVD_PAPERS', 'EVD_OPENSOURCE', 'EVD_JOBS', 'EVD_DYNAMICS', 'EVD_PATENTS'];
        for (const key of collectionKeys) {
            item = DataService.getDocument(key, feedId);
            if (item) break;
        }
    }

    if (!item) return { error: `未找到 ID 为 ${feedId} 的信息` };

    // 格式化相关实体名称
    const relatedEntityNames = (item.linked_entity_ids || []).map(id => {
        const entity = DataService.getDocument('REG_ENTITIES', id);
        return entity ? entity.primary_name : id;
    }).join(', ');

    return {
        title: item.title,
        summary: item.ai_summary || item.summary,
        sourceType: DashboardService._getTaskTypeFromFinding(item),
        publicationDate: DateUtils.formatDate(item.publication_timestamp || item.created_timestamp),
        relatedEntities: relatedEntityNames,
        sourceUrl: item.url || `#findings/${item.id}`
    };
  },

  /**
   * [API] 获取实体过滤器的选项。
   * 匹配 mock_api.js -> ExplorationService.getEntityFilterOptions
   * @returns {object} { entityTypes: [], industries: [], locations: [], statuses: [] }
   */
  getEntityFilterOptions: function() {
    const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
    
    const entityTypes = new Set();
    const industries = new Set(); // 对应 category
    const locations = new Set(); // 对应 headquarters
    const statuses = new Set(); // 对应 monitoring_status

    allEntities.forEach(e => {
        if (e.entity_type) entityTypes.add(e.entity_type);
        if (e.category) industries.add(e.category);
        if (e.headquarters) locations.add(e.headquarters);
        if (e.monitoring_status) statuses.add(e.monitoring_status);
    });

    return {
        entityTypes: Array.from(entityTypes),
        industries: Array.from(industries),
        locations: Array.from(locations),
        statuses: Array.from(statuses)
    };
  },

  // 以下方法在后端暂时保持 Mock 实现，因为涉及复杂文件处理或外部API
  // 它们在前端通过 MOCK_API 模拟，未来可以逐步实现
  analyzeUrl: function(url) {
    Logger.log(`[ExplorationService] Mock analyzeUrl called for: ${url}`);
    // 实际实现需要：UrlFetchApp获取内容 -> ProcessingService处理 -> 返回FND_MASTER格式
    // 这里简单返回一个模拟结果，确保前端不报错
    return {
        finalRecord: {
            id: `url-analysis-${Utilities.getUuid()}`,
            title: `模拟分析报告: ${url.substring(0, 30)}...`,
            ai_summary: `这是对URL [${url.substring(0, 50)}...] 的模拟AI分析摘要。`,
            ai_keywords: ["模拟", "URL", "分析"],
            source_platform: new URL(url).hostname,
            publication_date: new Date().toISOString()
        }
    };
  },
  startFileUpload: function(fileName, fileType) {
    Logger.log(`[ExplorationService] Mock startFileUpload called for: ${fileName}`);
    return { uploadId: `mock-upload-${Utilities.getUuid()}` };
  },
  appendFileChunk: function(uploadId, chunk) {
    Logger.log(`[ExplorationService] Mock appendFileChunk called for: ${uploadId}`);
    return { success: true };
  },
  finishFileUpload: function(uploadId) {
    Logger.log(`[ExplorationService] Mock finishFileUpload called for: ${uploadId}`);
    return { jobId: `mock-job-${Utilities.getUuid()}`, message: "Mock upload complete, analysis started." };
  },
  getAnalysisStatus: function(jobId) {
    // 模拟一个简单的状态机
    const statusSequence = [ '正在解析文件结构', '提取文本内容', 'AI实体识别', 'AI摘要与价值评估', '完成' ];
    const currentStatusIndex = (this._mockJobStatus[jobId] = (this._mockJobStatus[jobId] || 0) + 1);

    if (currentStatusIndex < statusSequence.length) {
      return { status: statusSequence[currentStatusIndex - 1], progress: Math.round((currentStatusIndex / statusSequence.length) * 100), result: null };
    } else {
      delete this._mockJobStatus[jobId];
      return {
        status: 'Completed',
        progress: 100,
        result: {
          id: jobId,
          title: `模拟文件分析报告: ${jobId.substring(jobId.length - 6)}`,
          ai_summary: '这是对一个模拟上传文件的最终AI分析摘要。',
          ai_keywords: ['模拟', '文件', '成功'],
          source_platform: '文件上传',
          publication_date: new Date().toISOString()
        }
      };
    }
  },
  _mockJobStatus: {} // 内部状态存储，仅用于模拟
};
