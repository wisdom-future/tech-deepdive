/**
 * @file layer03.SourceTechService.js
 * @description [完整重构版 v2.0] 技术实体驱动的采集服务。
 * 采用分块查询（Chunking Query）策略，在合并API调用的同时，遵循不同API对查询复杂度的限制。
 * 这是该文件的完整、最终版本。
 */

const TechnologySourceDriver = {

  /**
   * 定义每个数据源单次查询能接受的最大OR关键词数量。
   * key是REG_SOURCES中的source_id。
   * 对于不支持复杂查询的，设为1。对于未知的，设一个保守值。
   */
  SOURCE_QUERY_CHUNK_SIZE: {
    'NEWSAPI_ORG': 5,          // NewsAPI 文档建议不要太复杂，5是个安全值
    'HACKERNEWS_API': 1,      // Algolia 引擎比较强大，可以接受更多
    'GITHUB_API': 5,           // GitHub 搜索查询长度也有限制
    'ARXIV_API': 1,            // arXiv 的布尔查询最弱，一次只查一个关键词最稳妥
    'DEFAULT': 3               // 其他未定义数据源的默认值
  },

  /**
   * 定义此驱动器关心的数据源类型及其对应的任务类型。
   */
  SOURCE_CONFIG: {
    'academic_paper_source': 'ACADEMIC_PAPER',
    'patent_data_source': 'PATENT',
    'opensource_data_source': 'OPENSOURCE',
    'news_source': 'TECH_NEWS',
    'academic_conference_source': 'ACADEMIC_PAPER'
  },

  /**
   * 主运行函数，由Jobs.gs中的定时任务调用。
   */
  run: async function() {
    const driverName = 'TechnologySourceDriver';
    Logger.log(`[${driverName}] --- 开始执行技术驱动采集 (分块查询版) ---`);

    if (CONFIG.ENVIRONMENT.USE_GCP_SERVICES) {
      Logger.log(`[${driverName}] 检测到GCP模式，将调用云端采集器...`);
      return this._runOnGCP();
    } else {
      Logger.log(`[${driverName}] 检测到本地模式，将使用Apps Script执行...`);
      await this._runOnAppsScript();
    }
  },

  /**
   * [PRIVATE] 在Apps Script环境中执行采集。
   */
  _runOnAppsScript: async function() {
    const driverName = 'TechnologySourceDriver (Local)';
    let totalQueuedCount = 0;
    let totalErrorCount = 0;

    try {
      // 1. 获取所有需要监控的技术实体
      const monitoredTechs = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
          { field: 'entity_type', operator: 'EQUAL', value: 'Technology' },
          { field: 'monitoring_status', operator: 'EQUAL', value: 'active' }
        ]
      });

      if (!monitoredTechs || monitoredTechs.length === 0) {
        Logger.log(`[${driverName}] 未找到活跃监控的技术实体。`);
        return;
      }

      // 2. 将实体按其关键词分组，并建立 关键词 -> 实体ID 的反向映射
      const keywordToEntityMap = new Map();
      const allUniqueKeywords = []; // 用于构建分块查询的关键词列表

      monitoredTechs.forEach(tech => {
        const extractedKeywords = Helpers.getSearchKeywordsForEntity(tech);
        
        extractedKeywords.forEach(keyword => {
          allUniqueKeywords.push(keyword); // 收集所有关键词用于分块查询
          if (!keywordToEntityMap.has(keyword)) {
            keywordToEntityMap.set(keyword, new Set());
          }
          keywordToEntityMap.get(keyword).add(tech.entity_id);
        });
      });
      
      const uniqueKeywordsForQuery = [...new Set(allUniqueKeywords)]; // 确保查询列表是唯一的
      Logger.log(`[${driverName}] 共发现 ${uniqueKeywordsForQuery.length} 个独立关键词需要监控。`);

      // 3. 按“数据源类型”进行外层循环
      for (const sourceType in this.SOURCE_CONFIG) {
        const taskType = this.SOURCE_CONFIG[sourceType];
        const sources = DataConnector.getAllActiveSourcesOfType(sourceType);
        if (sources.length === 0) continue;

        // 4. 按“具体数据源”（如NewsAPI, HackerNews）进行内层循环
        for (const source of sources) {
          // 5. 根据数据源确定分块大小
          const chunkSize = this.SOURCE_QUERY_CHUNK_SIZE[source.source_id] || this.SOURCE_QUERY_CHUNK_SIZE['DEFAULT'];
          Logger.log(`[${driverName}] Source '${source.display_name}' will be queried with chunk size: ${chunkSize}.`);

          // 6. 将所有关键词分块
          for (let i = 0; i < uniqueKeywordsForQuery.length; i += chunkSize) { // 遍历 uniqueKeywordsForQuery
            const keywordChunk = uniqueKeywordsForQuery.slice(i, i + chunkSize);
            
            try {
              // 7. 对每个块构建查询并调用API
              const combinedQuery = keywordChunk.map(k => `"${k}"`).join(' OR ');
              Logger.log(`[${driverName}] Querying chunk ${Math.floor(i/chunkSize) + 1} on '${source.display_name}' for keywords: ${combinedQuery}`);

              const response = await DataConnector.fetchExternalData(source, source.collection_endpoint_key, { q: combinedQuery });
              const rawItems = DataMapper.getRawItems(response, source.response_mapping_rules.items_path, source.response_type);

              if (rawItems && rawItems.length > 0) {
                // 8. 处理返回结果并创建任务
                const tasksToQueue = this._processAndAttributeItems(rawItems, source, taskType, keywordToEntityMap);
                
                if (tasksToQueue.length > 0) {
                  DataService.batchUpsert('QUEUE_TASKS', tasksToQueue, 'id');
                  totalQueuedCount += tasksToQueue.length;
                  Logger.log(`[${driverName}] Queued ${tasksToQueue.length} tasks from this chunk.`);
                }
              }
            } catch (e) {
              totalErrorCount++;
              Logger.log(`[${driverName}] ERROR on chunk query for '${source.display_name}': ${e.message}`);
            }
          }
        }
      }
      Logger.log(`[${driverName}] --- 结束，总共推送 ${totalQueuedCount} 任务，发生 ${totalErrorCount} 错误。---`);

    } catch (e) {
      Logger.log(`[${driverName}] FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

  /**
   * [PRIVATE] [新增辅助函数] 负责处理返回的条目，并将其归属到正确的实体
   * @param {Array} rawItems - 从API获取的原始条目数组。
   * @param {Object} source - 当前数据源的配置对象。
   * @param {string} taskType - 要创建的任务类型。
   * @param {Map} keywordToEntityMap - 关键词到实体ID数组的映射。
   * @returns {Array<Object>} 准备好入队的任务对象数组。
   */
  _processAndAttributeItems: function(rawItems, source, taskType, keywordToEntityMap) {
    const tasksToQueue = [];
    for (const rawItem of rawItems) {
        const mappedItem = DataMapper.map(rawItem, source.response_mapping_rules, source.response_type);
        if (!mappedItem) continue;

        const itemText = (mappedItem.title + ' ' + (mappedItem.summary || '')).toLowerCase();
        
        const linkedEntityIds = new Set();
        // 遍历映射表，检查文本内容包含了哪个关键词
        for (const [keyword, entityIdSet] of keywordToEntityMap.entries()) {
            if (itemText.includes(keyword.toLowerCase())) {
                entityIdSet.forEach(id => linkedEntityIds.add(id));
            }
        }

        if (linkedEntityIds.size > 0) {
            // 我们只取第一个匹配到的实体作为“触发实体”，但会将所有关联实体ID都记录下来
            const triggerEntityId = Array.from(linkedEntityIds)[0];
            
            tasksToQueue.push({
              id: `task_${Helpers.generateUuid()}`,
              task_type: taskType,
              task_status: 'PENDING',
              payload: { ...mappedItem, trigger_entity_id: triggerEntityId, all_linked_entity_ids: Array.from(linkedEntityIds) },
              source_id: source.source_id,
              created_timestamp: new Date(),
              retry_count: 0
            });
        }
    }
    return tasksToQueue;
  },
  
  /**
   * [PRIVATE] 调用GCP Cloud Function执行采集。
   */
  _runOnGCP: function() {
    const driverName = 'TechnologySourceDriver (GCP)';
    const gcpCollectorUrl = PropertiesService.getScriptProperties().getProperty('GCP_COLLECTOR_FUNCTION_URL');
    if (!gcpCollectorUrl) {
      Logger.log(`[${driverName}] ERROR: 未在项目属性中配置GCP_COLLECTOR_FUNCTION_URL。`);
      return;
    }
    
    try {
      const payload = {
        driver: 'technology' // 告知GCP调用哪个驱动器
      };

      const options = {
        method: "post",
        contentType: "application/json",
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      Logger.log(`[${driverName}] Calling GCP Collector Function...`);
      const response = UrlFetchApp.fetch(gcpCollectorUrl, options);
      const responseText = response.getContentText();
      Logger.log(`[${driverName}] GCP Response: ${responseText}`);

    } catch (e) {
      Logger.log(`[${driverName}] FATAL ERROR calling GCP: ${e.message}\n${e.stack}`);
    }
  }
};
