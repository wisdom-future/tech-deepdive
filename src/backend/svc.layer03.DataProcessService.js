/**
 * @file layer03.DataProcessService.js
 * @description [处理层] 数据加工处理服务。
 * [v16.0] 最终异步对齐版：基于真正返回Promise的DataConnector，安全地使用async/await。
 */

const ProcessingService = {
  
  /**
   * 核心任务处理流水线，最终修正版。
   * 修正了任务与实体关联丢失的根本问题。
   */
    processTaskQueue: async function() {
    const jobName = 'ProcessingService.processTaskQueue (v-final)';
    const BATCH_SIZE = 20;
    
    Logger.log(`\n============================================================`);
    Logger.log(`[${jobName}] --- 开始新一轮任务处理 (批次大小: ${BATCH_SIZE}) ---`);
    Logger.log(`============================================================\n`);
    
    try {
        const tasks = DataService.getDataAsObjects('QUEUE_TASKS', {
            orderBy: { field: 'created_timestamp', direction: 'ASCENDING' },
            limit: BATCH_SIZE
        });

        if (!tasks || tasks.length === 0) {
            Logger.log(`[STAGE 1] 任务获取: 任务队列为空，流程结束。`);
            return;
        }
        
        Logger.log(`[STAGE 1] 任务获取: 成功从队列中取出 ${tasks.length} 个任务。`);
        
        // --- STAGE 2: AI分析 ---
        Logger.log(`\n--- [STAGE 2] 开始AI批处理分析... ---`);
        const tasksGroupedByType = {};
        tasks.forEach(task => {
            if (!task || !task.payload) return;
            const type = task.task_type;
            if (!tasksGroupedByType[type]) tasksGroupedByType[type] = [];
            task.textForAI = `Title: ${task.payload.title || ''}\nSummary: ${task.payload.summary || task.payload.description || ''}`;
            tasksGroupedByType[type].push(task);
        });
        
        const analysisPromises = Object.entries(tasksGroupedByType).map(([type, group]) => {
            const promptTemplate = PromptLibrary.get(this._getPromptTemplateNameForTaskType(type));
            if (!promptTemplate) return Promise.resolve(null);
            const tasksForAI = group.map(task => ({ id: task.id, text: task.textForAI }));
            Logger.log(`  -> 正在为 ${group.length} 个 '${type}' 类型的任务调用AI...`);
            return DataConnector.getBatchCompletions(promptTemplate, { TASKS_JSON: JSON.stringify(tasksForAI) });
        });
        
        const allGroupsResults = await Promise.all(analysisPromises);
        const analysisResultsMap = new Map();
        allGroupsResults.forEach(groupResult => {
            if (groupResult?.results) {
                groupResult.results.forEach(res => analysisResultsMap.set(res.id, res.analysis || { error: res.error || "未知AI分析错误" }));
            }
        });

        // ✅ [核心修正] 将AI分析结果直接附加到每个task对象上
        tasks.forEach(task => {
            task.analysis = analysisResultsMap.get(task.id);
        });
        Logger.log(`--- [STAGE 2] AI批处理分析完成。---\n`);

        // --- STAGE 3: 价值过滤 ---
        Logger.log(`--- [STAGE 3] 开始价值评估... ---`);
        const INGESTION_THRESHOLD = 4;
        const finalTasks = tasks.filter(task => task.analysis && !task.analysis.error && (task.analysis.value_score || 0) >= INGESTION_THRESHOLD);
        const rejectedCount = tasks.length - finalTasks.length;
        Logger.log(`--- [STAGE 3] 价值评估完成。通过: ${finalTasks.length}，拒绝: ${rejectedCount}。---\n`);

        if(finalTasks.length === 0) {
            Logger.log(`[${jobName}] 没有任务通过价值评估，流程提前结束。`);
            const taskIdsToDelete = tasks.map(t => t.id).filter(Boolean);
            if (taskIdsToDelete.length > 0) DataService.batchDeleteDocs('QUEUE_TASKS', taskIdsToDelete);
            return;
        }

        // --- STAGE 4: 实体解析与向量嵌入 ---
        Logger.log(`--- [STAGE 4] 开始实体解析与向量嵌入... ---`);
        const dictionaries = this._getEntityDictionaries();
        const textsForEmbedding = finalTasks.map(task => ({ id: task.id, text: task.textForAI }));

        // ✅ [核心修正] 为每个task独立进行实体解析，并把结果存回task对象
        const entityResolutionPromises = finalTasks.map(task => this._resolveEntitiesForSingleTask(task, dictionaries, jobName));

        const [resolvedTasks, embeddingResults] = await Promise.all([
            Promise.all(entityResolutionPromises),
            DataConnector.getBatchEmbeddings(textsForEmbedding.map(t => t.text))
        ]);
        
        const embeddingsMap = new Map(embeddingResults.map((embedding, index) => [textsForEmbedding[index].id, embedding]));
        // 将解析出的实体ID和新实体附加回每个task
        finalTasks.forEach((task, index) => {
            task.resolvedEntityIds = resolvedTasks[index].resolvedIds;
            task.newEntitiesToCreate = resolvedTasks[index].newEntities;
            task.embedding = embeddingsMap.get(task.id);
        });
        Logger.log(`--- [STAGE 4] 实体解析与向量嵌入完成。---\n`);

        // --- STAGE 5 & 6: 构建记录并写入数据库 ---
        Logger.log(`--- [STAGE 5 & 6] 开始构建最终记录并写入数据库... ---`);
        const recordsToUpsert = {};
        const allNewEntitiesToCreate = new Map();

        for (const task of finalTasks) {
            const finalRecord = await this._buildFinalRecord(task); // 现在build函数只依赖task本身
            const evidenceCollectionKey = this._getEvidenceCollectionKey(task.task_type);
            if (evidenceCollectionKey) {
              if(!recordsToUpsert[evidenceCollectionKey]) recordsToUpsert[evidenceCollectionKey] = [];
              recordsToUpsert[evidenceCollectionKey].push(finalRecord);
            }
            if(!recordsToUpsert['FND_MASTER']) recordsToUpsert['FND_MASTER'] = [];
            recordsToUpsert['FND_MASTER'].push(this._buildFindingRecord(finalRecord));
            
            // 收集所有新实体
            if (task.newEntitiesToCreate) {
              task.newEntitiesToCreate.forEach((entity, id) => {
                if (!allNewEntitiesToCreate.has(id)) allNewEntitiesToCreate.set(id, entity);
              });
            }
        }
        
        if (allNewEntitiesToCreate.size > 0) {
          recordsToUpsert['REG_ENTITIES'] = Array.from(allNewEntitiesToCreate.values());
        }

        for (const key in recordsToUpsert) {
            if (recordsToUpsert[key]?.length > 0) {
                const idField = key === 'REG_ENTITIES' ? 'entity_id' : 'id';
                Logger.log(`  -> 正在向集合 '${key}' 批量写入 ${recordsToUpsert[key].length} 条记录...`);
                DataService.batchUpsert(key, recordsToUpsert[key], idField);
            }
        }
        Logger.log(`--- [STAGE 5 & 6] 数据库写入完成。---\n`);

        // --- STAGE 7: 清理任务队列 ---
        Logger.log(`--- [STAGE 7] 开始清理已处理任务... ---`);
        const taskIdsToDelete = tasks.map(t => t.id).filter(Boolean);
        if (taskIdsToDelete.length > 0) {
            DataService.batchDeleteDocs('QUEUE_TASKS', taskIdsToDelete);
            Logger.log(`  -> 成功从队列中删除 ${taskIdsToDelete.length} 个任务。`);
        }
        Logger.log(`--- [STAGE 7] 任务清理完成。---\n`);
        
        Logger.log(`============================================================`);
        Logger.log(`[${jobName}] --- 本轮处理圆满完成。成功 ${finalTasks.length} 个，拒绝/失败 ${rejectedCount} 个。---`);
        Logger.log(`============================================================\n`);

    } catch (e) {
        Logger.log(`[${jobName}] (Local) FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

  // =================================================================================
  // SECTION: 私有辅助函数 (Private Helper Functions)
  // =================================================================================

  _getEntityDictionaries: function() {
    const dictionaries = {
        Company: new Map(), Technology: new Map(), Person: new Map(), Product: new Map(), Financial_Concept: new Map(),
        Organization_List: new Map(), Business_Event: new Map(), Research_Firm: new Map(), Publishing_Platform: new Map(), Other: new Map()
    };
    try {
        const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
        for (const entity of allEntities) {
            if (!entity || !entity.primary_name || !entity.entity_id || !entity.entity_type) continue;
            const targetDict = dictionaries[entity.entity_type] || dictionaries.Other;
            targetDict.set(entity.primary_name.trim().toLowerCase(), entity.entity_id);
            if (entity.aliases && Array.isArray(entity.aliases)) {
                entity.aliases.forEach(alias => {
                    if (alias && typeof alias === 'string') targetDict.set(alias.trim().toLowerCase(), entity.entity_id);
                });
            }
        }
    } catch (e) {
        throw new Error(`Failed to build entity dictionaries: ${e.message}`);
    }
    return dictionaries;
  },

  _resolveAndCreateEntities: async function(candidateNames, entityType, dictionaries, wfName) {
    const newEntitiesToUpsert = new Map();
    const resolvedIds = new Set();
    const safeCandidateNames = Array.isArray(candidateNames) ? [...new Set(candidateNames.map(c => String(c).trim()).filter(Boolean))] : [];
    if (safeCandidateNames.length === 0) return { resolvedIds, newEntities: newEntitiesToUpsert };

    const targetDict = dictionaries[entityType];
    if (!targetDict) return { resolvedIds, newEntities: newEntitiesToUpsert };

    const normalizationResult = await DataConnector.getBatchCompletions(PromptLibrary.get('entity_normalization'), {
        CANDIDATE_NAMES_JSON: JSON.stringify(safeCandidateNames),
        ENTITY_TYPE: entityType
    });

    if (!normalizationResult || !normalizationResult.normalized_groups) return { resolvedIds, newEntities: newEntitiesToUpsert };

    for (const group of normalizationResult.normalized_groups) {
        if (!group.primary_name) continue;
        const primaryName = group.primary_name;
        const primaryNameLower = primaryName.trim().toLowerCase();
        const aliases = Array.isArray(group.aliases) ? group.aliases : [];
        
        let entityId = targetDict.get(primaryNameLower) || aliases.map(a => targetDict.get(String(a).trim().toLowerCase())).find(id => id);

        if (entityId) {
            resolvedIds.add(entityId);
        } else {
            if (primaryName && primaryName.trim().length > 2) {
                const idPrefix = `${entityType.slice(0, 4).toLowerCase()}_`;
                const newEntityId = `${idPrefix}${Helpers.normalizeForId(primaryName)}`;
                if (!newEntitiesToUpsert.has(newEntityId)) {
                    const newEntityObject = {
                        entity_id: newEntityId,
                        primary_name: primaryName,
                        entity_type: entityType,
                        aliases: aliases,
                        created_timestamp: new Date(),
                        updated_timestamp: new Date(),
                        monitoring_status: 'pending_review'
                    };
                    newEntitiesToUpsert.set(newEntityId, newEntityObject);
                    resolvedIds.add(newEntityId);
                    targetDict.set(primaryNameLower, newEntityId);
                    aliases.forEach(alias => targetDict.set(String(alias).trim().toLowerCase(), newEntityId));
                } else {
                    resolvedIds.add(newEntityId);
                }
            } else {
                // 如果名称无效，则记录日志并跳过，不再创建无效实体
                Logger.log(`[${wfName}] Skipped creating entity with invalid primary name: "${primaryName}"`);
            }
        }
    }
    return { resolvedIds, newEntities: newEntitiesToUpsert };
  },

  _resolveAndCreateEntitiesBatch: async function(candidatesByType, dictionaries, wfName) {
    const allNewEntities = new Map();
    const allResolvedIds = new Map();
    for (const [entityType, candidateNamesSet] of candidatesByType.entries()) {
        const resolutionResult = await this._resolveAndCreateEntities(Array.from(candidateNamesSet), entityType, dictionaries, `${wfName}-Batch`);
        allResolvedIds.set(entityType, resolutionResult.resolvedIds);
        resolutionResult.newEntities.forEach((entity, id) => {
            if (!allNewEntities.has(id)) allNewEntities.set(id, entity);
        });
    }
    return { resolvedIds: allResolvedIds, newEntities: allNewEntities };
  },

  // ✅ [新增] 辅助函数，为单个任务解析实体
  _resolveEntitiesForSingleTask: async function(task, dictionaries, wfName) {
      const allResolvedIds = new Set();
      const allNewEntities = new Map();
      if (!task.analysis) return { resolvedIds: allResolvedIds, newEntities: allNewEntities };

      for (const key in task.analysis) {
          if (key.startsWith('candidate_') && Array.isArray(task.analysis[key]) && task.analysis[key].length > 0) {
              const entityType = this._mapCandidateKeyToEntityType(key);
              if (!entityType || entityType === 'Other') continue;
              
              const resolutionResult = await this._resolveAndCreateEntities(task.analysis[key], entityType, dictionaries, `${wfName}-SingleTask`);
              resolutionResult.resolvedIds.forEach(id => allResolvedIds.add(id));
              resolutionResult.newEntities.forEach((entity, id) => {
                  if (!allNewEntities.has(id)) allNewEntities.set(id, entity);
              });
          }
      }
      return { resolvedIds: allResolvedIds, newEntities: allNewEntities };
  },

  // ✅ [修正] _buildFinalRecord 现在只依赖 task 对象
  _buildFinalRecord: async function(task) {
    const { id: taskId, task_type, payload, analysis, embedding, resolvedEntityIds } = task;
    const finalRecord = {
        id: `evd_${Helpers.generateUuid()}`,
        duplicate_check_hash: Helpers.generateHash(payload.url || payload.title),
        processing_status: 'processed',
        task_id: taskId,
        task_type: task_type,
        source_id: payload.source_id, // 从 payload 获取
        trigger_entity_id: payload.trigger_entity_id,
        ingestion_timestamp: new Date(),
        ai_summary: analysis.ai_summary,
        ai_keywords: analysis.ai_keywords,
        ai_value_score: analysis.value_score,
        embedding_vector: embedding,
        has_embedding: !!embedding,
        title: payload.title,
        summary: payload.summary,
        url: payload.url,
        publication_timestamp: payload.publication_date ? new Date(payload.publication_date) : new Date()
    };

    const linked_entity_ids = new Set(resolvedEntityIds || []);
    if (payload.trigger_entity_id) linked_entity_ids.add(payload.trigger_entity_id);
    finalRecord.linked_entity_ids = Array.from(linked_entity_ids);

    finalRecord.evidence_chain = await this._buildEvidenceChain(finalRecord);
    return finalRecord;
  },

  _buildFindingRecord: function(finalRecord) {
      // ✅ [核心修正] 确保从证据记录中继承所有必要的字段
      return {
          id: `fnd_${Helpers.generateUuid()}`,
          finding_status: 'SIGNAL_IDENTIFIED',
          title: finalRecord.title,
          summary: finalRecord.ai_summary,
          keywords: finalRecord.ai_keywords,
          signal_strength_score: finalRecord.ai_value_score,
          linked_entity_ids: finalRecord.linked_entity_ids,
          primary_evidence_id: finalRecord.id,
          evidence_chain: finalRecord.evidence_chain,
          created_timestamp: new Date(),
          updated_timestamp: new Date(),
          // --- 新增的关键继承字段 ---
          task_type: finalRecord.task_type, // 继承任务类型
          url: finalRecord.url, // 继承原始URL
          publication_timestamp: finalRecord.publication_timestamp // 继承发布时间
      };
  },

  _buildEvidenceChain: async function(primaryRecord) {
    const evidenceChain = [{
        evidence_id: primaryRecord.id,
        collection_key: this._getEvidenceCollectionKey(primaryRecord.task_type),
        relation_type: 'primary_source'
    }];
    // 继承您原有代码的、更复杂的证据链构建逻辑
    const MAX_EVIDENCE_ITEMS = 5;
    const searchEntityIds = primaryRecord.linked_entity_ids || [];
    if (searchEntityIds.length === 0) return evidenceChain;

    const searchWindowStart = new Date(primaryRecord.publication_timestamp.getTime() - 90 * 24 * 60 * 60 * 1000);
    const searchWindowEnd = new Date(primaryRecord.publication_timestamp.getTime() + 90 * 24 * 60 * 60 * 1000);
    
    const collectionsToSearch = {
        'EVD_PAPERS': 'publication_timestamp', 'EVD_PATENTS': 'publication_timestamp',
        'EVD_OPENSOURCE': 'publication_timestamp', 'EVD_NEWS': 'publication_timestamp',
        'EVD_DYNAMICS': 'publication_timestamp', 'EVD_JOBS': 'publication_timestamp'
    };

    for (const [collectionKey, orderByField] of Object.entries(collectionsToSearch)) {
        if (evidenceChain.length >= MAX_EVIDENCE_ITEMS) break;
        if (this._getEvidenceCollectionKey(primaryRecord.task_type) === collectionKey) continue;

        try {
            const relatedItems = await DataService.getDataAsObjects(collectionKey, {
                filters: [
                    { field: orderByField, operator: 'GREATER_THAN_OR_EQUAL', value: searchWindowStart },
                    { field: orderByField, operator: 'LESS_THAN_OR_EQUAL', value: searchWindowEnd },
                    { field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS_ANY', value: searchEntityIds.slice(0, 10) }
                ],
                orderBy: { field: orderByField, direction: 'DESCENDING' },
                limit: 1
            });

            if (relatedItems && relatedItems.length > 0) {
                const item = relatedItems[0];
                if (!evidenceChain.some(e => e.evidence_id === item.id)) { 
                    evidenceChain.push({
                        evidence_id: item.id,
                        collection_key: collectionKey,
                        relation_type: 'related_evidence'
                    });
                }
            }
        } catch (e) {
            Logger.log(`[_buildEvidenceChain] WARN: 查找集合 '${collectionKey}' 中的证据时出错: ${e.message}`);
        }
    }
    return evidenceChain;
  },
  
  _getPromptTemplateNameForTaskType: function(taskType) {
    const map = {
        'TECH_NEWS': 'news_analysis_batch', 'INDUSTRY_DYNAMICS': 'news_analysis_batch',
        'ACADEMIC_PAPER': 'papers_analysis_batch', 'ACADEMIC_CONFERENCE': 'papers_analysis_batch',
        'PATENT': 'patents_analysis_batch', 'TALENT_FLOW': 'jobs_analysis_batch',
        'ANALYST_REPORT': 'reports_analysis_batch', 'CORPORATE_FILING': 'reports_analysis_batch',
        'OPENSOURCE': 'news_analysis_batch'
    };
    return map[taskType] || 'news_analysis_batch';
  },

  _mapCandidateKeyToEntityType: function(candidateKey) {
    const map = {
      'candidate_companies': 'Company', 'candidate_techs': 'Technology', 'candidate_persons': 'Person', 'candidate_products': 'Product',
      'candidate_financial_concepts': 'Financial_Concept', 'candidate_organization_lists': 'Organization_List',
      'candidate_business_events': 'Business_Event', 'candidate_research_firms': 'Research_Firm',
      'candidate_publishing_platforms': 'Publishing_Platform'
    };
    return map[candidateKey] || 'Other';
  },

  _getEvidenceCollectionKey: function(taskType) {
      const map = {
        'TECH_NEWS': 'EVD_NEWS', 'INDUSTRY_DYNAMICS': 'EVD_DYNAMICS',
        'ACADEMIC_PAPER': 'EVD_PAPERS', 'ACADEMIC_CONFERENCE': 'EVD_PAPERS',
        'PATENT': 'EVD_PATENTS', 'TALENT_FLOW': 'EVD_JOBS',
        'ANALYST_REPORT': 'EVD_REPORTS', 'CORPORATE_FILING': 'EVD_FILINGS',
        'OPENSOURCE': 'EVD_OPENSOURCE'
      };
      return map[taskType];
  }
};
