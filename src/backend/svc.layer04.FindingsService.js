/**
 * @file layer04.FindingsService.js
 * @description [API服务层] 研究成果管理服务。
 * 为前端“成果中心”页面提供对“发现”和“报告”的查询、归档等管理功能。
 */

const FindingsService = {

  /**
   * [API] 获取“发现”列表，支持分页和筛选。
   * 匹配 mock_api.js -> FindingsService.getFindings
   * @param {string} apiType - 'insights', 'snapshots', 'reports'
   * @param {Object} options - 包含筛选条件的选项 { keyword, page, limit, sortBy, sortOrder }
   * @returns {{records: Array, totalRecords: number}}
   */
  listFindings: function(apiType, options = {}) {
    let collectionKey;
    switch(apiType) {
        case 'insights': collectionKey = 'FND_MASTER'; break;
        case 'snapshots': collectionKey = 'ANL_SNAPSHOTS'; break; // 假设有一个快照集合
        case 'reports': collectionKey = 'LOG_REPORTS_HISTORY'; break;
        default: return { records: [], totalRecords: 0 };
    }

    const { page = 1, limit = 20, keyword = '', sortBy = 'created_timestamp', sortOrder = 'DESCENDING' } = options;
    
    let filters = [];
    if (keyword) {
        // 简单模糊匹配 title 或 summary，实际可能需要更复杂的搜索
        filters.push({ field: 'title', operator: 'CONTAINS', value: keyword }); // Firestore 不直接支持 CONTAINS
        // 替代方案：获取所有，然后在内存中过滤 (小数据量可行)
    }

    // 获取所有符合过滤条件的
    const allRecords = DataService.getDataAsObjects(collectionKey, { filters: filters }) || [];

    // 如果有 keyword 过滤，则在内存中进行
    const filteredRecords = keyword ? allRecords.filter(item => 
        (item.title && item.title.toLowerCase().includes(keyword.toLowerCase())) ||
        (item.summary && item.summary.toLowerCase().includes(keyword.toLowerCase()))
    ) : allRecords;

    const totalRecords = filteredRecords.length;
    const startIndex = (page - 1) * limit;
    const paginatedRecords = filteredRecords.slice(startIndex, startIndex + limit);

    // 格式化输出以匹配前端期望
    const records = paginatedRecords.map(item => {
        switch(apiType) {
            case 'insights':
                return {
                    id: item.id,
                    title: item.title,
                    content: item.ai_summary || item.summary,
                    tags: item.ai_keywords || [],
                    createdBy: item.created_by || 'AI分析', // 假设 FND_MASTER 有 created_by
                    createdAt: DateUtils.formatDate(item.created_timestamp)
                };
            case 'snapshots':
                return {
                    id: item.id,
                    title: item.title,
                    description: item.description,
                    imageUrl: item.image_url, // 假设保存时有这个字段
                    analysisType: item.analysis_type,
                    targetEntity: item.target_entity_id,
                    createdAt: DateUtils.formatDate(item.created_timestamp)
                };
            case 'reports':
                return {
                    id: item.id,
                    title: item.report_name, // 假设报告名称
                    summary: item.report_summary,
                    author: item.author || '系统',
                    publishedAt: DateUtils.formatDate(item.generation_date)
                    // contentBlocks 暂时不返回，前端再根据ID请求
                };
            default: return item;
        }
    });

    return { records, totalRecords };
  },

  /**
   * [API] 获取单个“发现”的完整详情，包括其所有证据链信息。
   * 匹配 mock_api.js -> FindingsService.getFindingDetails
   * @param {string} apiType - 'insights', 'snapshots', 'reports'
   * @param {string} id - “发现”的ID。
   * @returns {Object} 完整的“发现”对象及其证据详情。
   */
  getFindingDetails: function(apiType, id) {
    let item;
    switch(apiType) {
        case 'insights': item = DataService.getDocument('FND_MASTER', id); break;
        case 'snapshots': item = DataService.getDocument('ANL_SNAPSHOTS', id); break;
        case 'reports': item = DataService.getDocument('LOG_REPORTS_HISTORY', id); break;
        default: return { error: `不支持的类型: ${apiType}` };
    }
    
    if (!item) return { error: `未找到 ID 为 ${id} 的${apiType}。`};

    // 根据 apiType 格式化返回
    switch(apiType) {
        case 'insights':
            return {
                title: item.title,
                content: item.ai_summary || item.summary,
                tags: item.ai_keywords || [],
                createdBy: item.created_by || 'AI分析',
                createdAt: DateUtils.formatDate(item.created_timestamp),
                relatedEntities: (item.linked_entity_ids || []).map(id => {
                    const entity = DataService.getDocument('REG_ENTITIES', id);
                    return entity ? entity.primary_name : id;
                }).join(', '),
                sourceUrl: item.url || `#findings/${item.id}` // 关联到原始来源
            };
        case 'snapshots':
            return {
                title: item.title,
                description: item.description,
                imageUrl: item.image_url,
                analysisType: item.analysis_type,
                targetEntity: item.target_entity_id,
                createdAt: DateUtils.formatDate(item.created_timestamp)
            };
        case 'reports':
            // 报告详情需要包含 contentBlocks 及其内容
            const hydratedContent = (item.content_blocks || []).map(block => {
                let blockContent = null;
                if (block.type === 'insight') {
                    blockContent = DataService.getDocument('FND_MASTER', block.id);
                } else if (block.type === 'snapshot') {
                    blockContent = DataService.getDocument('ANL_SNAPSHOTS', block.id);
                }
                return blockContent ? { ...block, data: blockContent } : block;
            });
            return {
                title: item.report_name,
                summary: item.report_summary,
                author: item.author,
                publishedAt: DateUtils.formatDate(item.generation_date),
                contentBlocks: hydratedContent
            };
        default: return item;
    }
  },

  /**
   * [API] 更新一个“发现”的状态（如：归档、发布）。
   */
  updateFindingStatus: function(findingId, newStatus) {
    DataService.updateObject('FND_MASTER', findingId, {
      finding_status: newStatus,
      updated_timestamp: new Date()
    });
    return { success: true };
  },

  /**
   * [API] 获取已生成的报告历史列表。
   */
  listReportsHistory: function(page = 1, limit = 15) {
    try {
      const allHistory = DataService.getDataAsObjects('LOG_REPORTS_HISTORY');
      if (!allHistory) return { records: [], totalRecords: 0 };
      
      allHistory.sort((a, b) => new Date(b.generation_date || 0) - new Date(a.generation_date || 0));
      
      const totalRecords = allHistory.length;
      const startIndex = (page - 1) * limit;
      const recordsOnPage = allHistory.slice(startIndex, startIndex + limit).map(record => {
          record.generation_date = DateUtils.formatDate(record.generation_date, true);
          record.report_period_start = DateUtils.formatDate(record.report_period_start);
          record.report_period_end = DateUtils.formatDate(record.report_period_end);
          return record;
      });
      return { records: recordsOnPage, totalRecords: totalRecords };
    } catch (e) {
      throw new Error(`Failed to retrieve reports history: ${e.message}`);
    }
  },

  /**
   * [API] 手动触发报告生成。
   */
  generateReport: function(options) {
    Logger.log(`[FindingsService] Report generation triggered with options: ${JSON.stringify(options)}`);
    // 实际的报告生成逻辑会在这里，可能涉及CopilotService
    return { success: true, message: "报告生成任务已启动，请稍后在历史记录中查看。", taskId: `report_${Helpers.generateUuid()}` };
  },

  /**
   * [API] 保存前端生成的快照。
   * 匹配 mock_api.js -> FindingsService.saveSnapshot
   * @param {object} snapshotData - 包含快照元数据和 imageData (Base64)
   * @returns {object} { success: boolean, snapshotId: string }
   */
  saveSnapshot: function(snapshotData) {
    const jobName = 'FindingsService.saveSnapshot';
    Logger.log(`[${jobName}] Saving snapshot: ${snapshotData.title}`);

    try {
        const newSnapshotId = `snap_${Helpers.generateUuid()}`;
        const imageUrl = `data:image/png;base64,${snapshotData.imageData.split(',')[1]}`; // 假设 imageData 是 data URL

        const snapshotToSave = {
            id: newSnapshotId,
            title: snapshotData.title,
            description: snapshotData.description,
            image_url: imageUrl, // 存储 Base64 图片数据
            analysis_type: snapshotData.analysisType,
            target_entity_id: snapshotData.targetEntity,
            created_timestamp: new Date(snapshotData.createdAt), // 使用前端传入的时间
            updated_timestamp: new Date()
        };

        DataService.batchUpsert('ANL_SNAPSHOTS', [snapshotToSave], 'id'); // 假设有 ANL_SNAPSHOTS 集合
        Logger.log(`[${jobName}] Snapshot saved successfully: ${newSnapshotId}`);
        return { success: true, snapshotId: newSnapshotId };
    } catch (e) {
        Logger.log(`[${jobName}] ERROR saving snapshot: ${e.message}\n${e.stack}`);
        return { success: false, error: `保存快照失败: ${e.message}` };
    }
  },

  /**
   * [API] 获取公司时间轴数据。
   * 匹配 mock_api.js -> FindingsService.getCompanyTimeline
   * @param {string} companyId - 公司实体ID
   * @returns {object} { aiSummary, keyThemes, mostImportantEvent, events: [{date, title, summary, tags}] }
   */
  getCompanyTimeline: function(companyId) {
    const jobName = 'FindingsService.getCompanyTimeline';
    Logger.log(`[${jobName}] Generating timeline for company: ${companyId}`);

    const company = DataService.getDocument('REG_ENTITIES', companyId);
    if (!company) {
        Logger.log(`[${jobName}] Company ${companyId} not found.`);
        return {
            aiSummary: `未找到公司 ${companyId} 的信息。`,
            keyThemes: [],
            mostImportantEvent: { title: '暂无', summary: '' },
            events: []
        };
    }

    const allFindings = DataService.getDataAsObjects('FND_MASTER', {
        filters: [{ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: companyId }],
        orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
        limit: 20 // 获取最近的20条信号
    }) || [];

    const events = allFindings.map(f => ({
        date: DateUtils.formatDate(f.publication_timestamp || f.created_timestamp),
        title: f.title,
        summary: f.ai_summary || f.summary,
        tags: f.ai_keywords || []
    }));

    // 简单模拟 aiSummary, keyThemes, mostImportantEvent
    const aiSummary = `关于 ${company.primary_name} 的最新月度 AI 分析摘要：该公司在过去一段时间内表现活跃，在 ${company.category || '其所在行业'} 领域有新的进展。${allFindings.length > 0 ? `共发现 ${allFindings.length} 条相关信号。` : ''}`;
    const keyThemes = [...new Set(allFindings.flatMap(f => f.ai_keywords || [])).values()].slice(0, 3);
    const mostImportantEvent = allFindings.length > 0 ? {
        title: allFindings[0].title, // 最新的作为最重要的
        summary: allFindings[0].ai_summary || allFindings[0].summary
    } : { title: '暂无关键事件', summary: '系统正在监控中。' };

    return {
        aiSummary: aiSummary,
        keyThemes: keyThemes,
        mostImportantEvent: mostImportantEvent,
        events: events
    };
  }
};
