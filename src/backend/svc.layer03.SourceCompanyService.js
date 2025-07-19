/**
 * @file layer03.SourceCompanyService.js
 * @description [完整重构版 v2.0] 公司实体驱动的采集服务。
 * 采用分块查询（Chunking Query）策略，在合并API调用的同时，遵循不同API对查询复杂度的限制。
 * 这是该文件的完整、最终版本。
 */

const CompanySourceDriver = {

  /**
   * 定义每个数据源单次查询能接受的最大OR关键词数量。
   * key是REG_SOURCES中的source_id。
   */
  SOURCE_QUERY_CHUNK_SIZE: {
    'NEWSAPI_ORG': 5,
    'HACKERNEWS_API': 10,
    'DEFAULT': 3
  },

  /**
   * 定义此驱动器关心的数据源类型、查询方式和任务类型。
   */
  SOURCE_CONFIG: {
    'news_source': { task_type: 'TECH_NEWS', query_field: 'primary_name' },
    'job_search_source': { task_type: 'TALENT_FLOW', query_field: 'primary_name' },
    'industry_dynamics_source': { task_type: 'INDUSTRY_DYNAMICS', query_field: 'primary_name' },
    'investment_report_source': { task_type: 'ANALYST_REPORT', query_field: 'stock_symbol' },
    'corporate_filing_source': { task_type: 'CORPORATE_FILING', query_field: 'stock_symbol' },
    'rss_source': { task_type: 'INDUSTRY_DYNAMICS', query_field: 'rss_feeds' }
  },

  /**
   * 主运行函数，由Jobs.gs中的定时任务调用。
   */
  run: async function() {
    const driverName = 'CompanySourceDriver';
    Logger.log(`[${driverName}] --- 开始执行公司驱动采集 (分块查询版) ---`);

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
    const driverName = 'CompanySourceDriver (Local)';
    let totalQueuedCount = 0;
    let totalErrorCount = 0;

    try {
      const monitoredCompanies = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
          { field: 'entity_type', operator: 'EQUAL', value: 'Company' },
          { field: 'monitoring_status', operator: 'EQUAL', value: 'active' }
        ]
      });

      if (!monitoredCompanies || monitoredCompanies.length === 0) {
        Logger.log(`[${driverName}] 未找到活跃监控的公司实体。`);
        return;
      }

      const keywordToEntityMap = new Map(); // 用于处理非RSS源的实体归属

      for (const sourceType in this.SOURCE_CONFIG) {
        const config = this.SOURCE_CONFIG[sourceType];
        const sources = DataConnector.getAllActiveSourcesOfType(sourceType); // 获取匹配 sourceType 的数据源
        if (sources.length === 0) {
            Logger.log(`[${driverName}] INFO: 未找到类型为 '${sourceType}' 的活跃数据源配置。`);
            continue;
        }

        // --- 新增：处理 RSS 数据源 ---
        if (sourceType === 'rss_source') {
          const rssParserSource = sources[0]; // 假设只有一个 RSS 解析服务 (RSS_TO_JSON_API)
          if (!rssParserSource) {
            Logger.log(`[${driverName}] WARN: 未找到活跃的 'rss_parser_service' 类型数据源。RSS 采集将被跳过。`);
            continue;
          }

          Logger.log(`[${driverName}] 开始从 RSS 源采集产业动态...`);
          for (const company of monitoredCompanies) {
            const rssFeeds = company.rss_feeds; // 从公司实体获取 RSS Feed 列表
            if (!rssFeeds || rssFeeds.length === 0) {
              continue;
            }

            for (const feed of rssFeeds) {
              const rssFeedUrl = feed.url;
              const specificTaskType = feed.task_type_override || config.task_type;

              if (!rssFeedUrl) {
                Logger.log(`[${driverName}] WARN: 公司 '${company.primary_name}' 的某个 RSS Feed URL 为空，已跳过。`);
                continue;
              }

              try {
                Logger.log(`[${driverName}] 正在采集公司 '${company.primary_name}' 的 RSS Feed: ${rssFeedUrl}`);
                const response = await DataConnector.fetchExternalData(
                  rssParserSource,
                  rssParserSource.collection_endpoint_key,
                  { url: rssFeedUrl }
                );

                const rawItems = DataMapper.getRawItems(response, rssParserSource.response_mapping_rules.items_path, rssParserSource.response_type);

                if (rawItems && rawItems.length > 0) {
                  const queuedCount = Helpers.createTasksFromItems(
                    rawItems,
                    specificTaskType,
                    rssParserSource.source_id,
                    company.entity_id,
                    rssParserSource
                  );
                  totalQueuedCount += queuedCount;
                  Logger.log(`[${driverName}] 从 '${rssFeedUrl}' 队列了 ${queuedCount} 个任务。`);
                } else {
                    Logger.log(`[${driverName}] INFO: 从 '${rssFeedUrl}' 未获取到新条目。`);
                }
              } catch (e) {
                totalErrorCount++;
                Logger.log(`[${driverName}] ERROR: 采集公司 '${company.primary_name}' 的 RSS Feed '${rssFeedUrl}' 时发生错误: ${e.message}`);
              }
            }
          }
        } else { // --- 现有：处理非 RSS 数据源（如 NewsAPI, SerpApi Jobs 等） ---
          const keywordsForQuery = [];
          monitoredCompanies.forEach(company => {
            const extractedKeywords = Helpers.getSearchKeywordsForEntity(company);
            
            extractedKeywords.forEach(keyword => {
                keywordsForQuery.push(keyword);
                if (!keywordToEntityMap.has(keyword)) {
                    keywordToEntityMap.set(keyword, new Set());
                }
                keywordToEntityMap.get(keyword).add(company.entity_id);
            });
          });
          
          if (keywordsForQuery.length === 0) {
            Logger.log(`[${driverName}] For source type '${sourceType}', no valid keywords found.`);
            continue;
          }
          
          for (const source of sources) {
            const chunkSize = this.SOURCE_QUERY_CHUNK_SIZE[source.source_id] || this.SOURCE_QUERY_CHUNK_SIZE['DEFAULT'];
            Logger.log(`[${driverName}] Source '${source.display_name}' will be queried with chunk size: ${chunkSize}.`);

            for (let i = 0; i < keywordsForQuery.length; i += chunkSize) {
              const keywordChunk = keywordsForQuery.slice(i, i + chunkSize);
              try {
                const combinedQuery = keywordChunk.map(k => `"${k}"`).join(' OR ');
                Logger.log(`[${driverName}] Querying chunk ${Math.floor(i/chunkSize) + 1} on '${source.display_name}' for keywords: ${combinedQuery}`);

                let apiParams = { q: combinedQuery };
                let tempSourceConfig = { ...source };

                if (config.query_field === 'stock_symbol' && source.endpoint_paths && source.collection_endpoint_key && source.endpoint_paths[source.collection_endpoint_key] && source.endpoint_paths[source.collection_endpoint_key].includes('{symbol}')) {
                    if (keywordChunk.length === 1) {
                        let endpointPath = source.endpoint_paths[source.collection_endpoint_key].replace('{symbol}', keywordChunk[0]);
                        tempSourceConfig.endpoint_paths = { ...source.endpoint_paths, [source.collection_endpoint_key]: endpointPath };
                        apiParams = {};
                    } else {
                        Logger.log(`[${driverName}] WARN: Source '${source.display_name}' requires symbol in path, but chunking is active. This source might not work correctly with multiple companies. Skipping chunk.`);
                        continue;
                    }
                }

                const response = await DataConnector.fetchExternalData(tempSourceConfig, source.collection_endpoint_key, apiParams);
                const rawItems = DataMapper.getRawItems(response, source.response_mapping_rules.items_path, source.response_type);

                if (rawItems && rawItems.length > 0) {
                  const tasksToQueue = this._processAndAttributeItems(rawItems, source, config.task_type, keywordToEntityMap);
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
      } // End of for sourceType loop

      Logger.log(`[${driverName}] --- 结束，总共推送 ${totalQueuedCount} 任务，发生 ${totalErrorCount} 错误。---`);

    } catch (e) {
      Logger.log(`[${driverName}] FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

  /**
   * [PRIVATE] 负责处理返回的条目，并将其归属到正确的实体
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
        // 这里 keywordToEntityMap 的 value 应该是 Set<entity_id>
        for (const [keyword, entityIdSet] of keywordToEntityMap.entries()) {
            if (itemText.includes(keyword.toLowerCase())) {
                entityIdSet.forEach(id => linkedEntityIds.add(id));
            }
        }

        if (linkedEntityIds.size > 0) {
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
    const driverName = 'CompanySourceDriver (GCP)';
    const gcpCollectorUrl = PropertiesService.getScriptProperties().getProperty('GCP_COLLECTOR_FUNCTION_URL');
    if (!gcpCollectorUrl) {
      Logger.log(`[${driverName}] ERROR: 未在项目属性中配置GCP_COLLECTOR_FUNCTION_URL。`);
      return;
    }
    
    try {
      const payload = {
        driver: 'company'
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
