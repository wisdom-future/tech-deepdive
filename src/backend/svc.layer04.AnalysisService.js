/**
 * @file layer04.AnalysisService.js
 * @description [API服务层] 洞察提炼与深度分析服务。
 * 负责执行所有基于已处理数据的“二次分析”和“增值”工作流，
 * 并为前端提供深度分析（如图谱、趋势）所需的API。
 * 
 * @version 2.0 (Corrected Signatures)
 * @changelog
 *  - [CRITICAL FIX] All public API methods now accept `authInfo` as the first parameter to align with the `callApi` gateway's invocation pattern. This fixes argument mismatch errors.
 */

const AnalysisService = {
  //==================================================================
  // SECTION 0: 配置 (确保这些常量已经存在且数值正确)
  //==================================================================
  INTELLIGENT_ENTITY_BATCH_SIZE: 30,
  INTELLIGENT_ENTITY_RE_ENRICH_INTERVAL_DAYS: 30, // 确保这里是数字 30

  //==================================================================
  // SECTION 1: 后台异步工作流 (由Jobs.gs调用)
  //==================================================================
    // ✅ [新增] 将此辅助函数移至 AnalysisService，以便多处复用
  _getTaskTypeFromFinding: function(finding) {
    // 优先从 primary_evidence_id 获取（如果存在且格式正确）
    if (finding && finding.primary_evidence_id) {
        const id = finding.primary_evidence_id;
        if (id.startsWith('evd_news')) return 'TECH_NEWS';
        if (id.startsWith('evd_dyn')) return 'INDUSTRY_DYNAMICS';
        if (id.startsWith('evd_pap')) return 'ACADEMIC_PAPER';
        if (id.startsWith('evd_pat')) return 'PATENT';
        if (id.startsWith('evd_job')) return 'TALENT_FLOW';
        if (id.startsWith('evd_rep')) return 'ANALYST_REPORT';
        if (id.startsWith('evd_fil')) return 'CORPORATE_FILING';
        if (id.startsWith('evd_ops')) return 'OPENSOURCE';
    }
    // 其次从 evidence_chain 中推断
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
    // 最后，如果 FND_MASTER 记录本身意外地包含了 task_type，则使用它
    if (finding && finding.task_type) return finding.task_type;
    
    return 'UNKNOWN';
  },

    /**
   * [PRIVATE] 智能实体标准化和潜在合并。
   * ✅ [v4.0 可续传版] 引入了基于 PropertiesService 的状态管理，以解决处理大量实体时（>1000）的6分钟执行超时问题。
   *    1. 使用 Script Properties 来保存和读取处理进度。
   *    2. 每次运行只处理一个批次，然后保存进度并退出。
   *    3. 提供了手动重置进度的函数 `MANUAL_resetNormalizationProgress`。
   */
  _intelligentEntityNormalization: async function() {
    const stageName = 'AnalysisService.Normalization_v4';
    const BATCH_SIZE = 50; // 显著减小每批次处理的数量，确保在超时前能完成
    const SCRIPT_PROPERTY_KEY = 'normalization_last_processed_index';

    try {
      // 1. 读取上次的处理进度
      const lastProcessedIndex = parseInt(PropertiesService.getScriptProperties().getProperty(SCRIPT_PROPERTY_KEY) || '-1', 10);
      
      // 2. 获取所有待处理的实体，并按ID排序以保证处理顺序的确定性
      const allPendingEntities = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [{ field: 'monitoring_status', operator: 'EQUAL', value: 'pending_review' }],
        orderBy: { field: '__name__', direction: 'ASCENDING' } 
      });

      if (!allPendingEntities || allPendingEntities.length === 0) {
        Logger.log(`[${stageName}] 没有待标准化的实体。任务完成。`);
        PropertiesService.getScriptProperties().deleteProperty(SCRIPT_PROPERTY_KEY); // 清理进度标记
        return { processed: 0, errors: 0 };
      }

      // 3. 从上次中断的地方开始，选取一个新的批次
      const nextIndex = lastProcessedIndex + 1;
      if (nextIndex >= allPendingEntities.length) {
        Logger.log(`[${stageName}] 所有 ${allPendingEntities.length} 个待处理实体均已处理完毕。`);
        PropertiesService.getScriptProperties().deleteProperty(SCRIPT_PROPERTY_KEY); // 清理进度标记
        return { processed: 0, errors: 0 };
      }

      const currentBatchEntities = allPendingEntities.slice(nextIndex, nextIndex + BATCH_SIZE);
      Logger.log(`[${stageName}] 待处理实体总数: ${allPendingEntities.length}。上次处理到索引: ${lastProcessedIndex}。本次将处理索引从 ${nextIndex} 到 ${nextIndex + currentBatchEntities.length - 1} 的实体。`);

      // 4. 对当前批次进行处理
      const entityTypesInBatch = [...new Set(currentBatchEntities.map(e => e.entity_type))];
      const dictionaries = ProcessingService._getEntityDictionaries();
      const allEntitiesMap = new Map(DataService.getDataAsObjects('REG_ENTITIES').map(e => [e.entity_id, e]));
      const updatesMap = new Map();
      const idsToDelete = new Set();
      let processedInBatch = 0;

      for (const entityType of entityTypesInBatch) {
        const entitiesOfTypeInBatch = currentBatchEntities.filter(e => e.entity_type === entityType);
        const candidateNames = entitiesOfTypeInBatch.map(e => e.primary_name).filter(Boolean);
        
        if (candidateNames.length === 0) continue;

        const normalizationResult = await DataConnector.getBatchCompletions(PromptLibrary.get('entity_normalization'), {
          CANDIDATE_NAMES_JSON: JSON.stringify(candidateNames),
          ENTITY_TYPE: entityType
        });

        if (!normalizationResult || !normalizationResult.normalized_groups) continue;

        for (const group of normalizationResult.normalized_groups) {
          if (!group.primary_name) continue;
          const primaryName = group.primary_name;
          const aliases = group.aliases || [];
          const allNamesInGroup = [primaryName, ...aliases].map(n => String(n).toLowerCase().trim());
          
          let canonicalEntity = null;
          for (const name of allNamesInGroup) {
            const potentialId = dictionaries[entityType]?.get(name);
            if (potentialId && allEntitiesMap.has(potentialId)) {
              canonicalEntity = allEntitiesMap.get(potentialId);
              break;
            }
          }
          if (!canonicalEntity) {
            canonicalEntity = entitiesOfTypeInBatch.find(e => allNamesInGroup.includes(e.primary_name.toLowerCase().trim()));
          }
          if (!canonicalEntity) {
             const firstEntityInGroup = entitiesOfTypeInBatch.find(e => e.primary_name.toLowerCase().trim() === allNamesInGroup[0]);
             if (firstEntityInGroup) {
               canonicalEntity = firstEntityInGroup;
             } else {
               Logger.log(`[${stageName}] WARN: 无法为组 '${primaryName}' 确定主体，跳过。`);
               continue;
             }
          }

          allNamesInGroup.forEach(name => {
            const originalEntity = entitiesOfTypeInBatch.find(e => e.primary_name.toLowerCase().trim() === name);
            if (originalEntity && originalEntity.entity_id !== canonicalEntity.entity_id) {
              updatesMap.set(originalEntity.entity_id, { entity_id: originalEntity.entity_id, monitoring_status: 'merged_into', merged_into_id: canonicalEntity.entity_id, updated_timestamp: new Date() });
              idsToDelete.add(originalEntity.entity_id);
            }
          });

          const existingUpdate = updatesMap.get(canonicalEntity.entity_id) || { entity_id: canonicalEntity.entity_id };
          const combinedAliases = new Set([...(canonicalEntity.aliases || []), ...(existingUpdate.aliases || []), ...aliases]);
          updatesMap.set(canonicalEntity.entity_id, { ...existingUpdate, primary_name: primaryName, aliases: Array.from(combinedAliases), monitoring_status: 'normalized', updated_timestamp: new Date() });
          processedInBatch++;
        }
      }

      const updatesToBatch = Array.from(updatesMap.values());
      if (updatesToBatch.length > 0) {
        DataService.batchUpsert('REG_ENTITIES', updatesToBatch, 'entity_id');
        Logger.log(`[${stageName}] 完成对 ${updatesToBatch.length} 个实体的标准化/合并更新。`);
      }
      if (idsToDelete.size > 0) {
        DataService.batchDeleteDocs('REG_ENTITIES', Array.from(idsToDelete));
        Logger.log(`[${stageName}] 删除了 ${idsToDelete.size} 个被合并的重复实体。`);
      }

      // 5. [核心] 更新处理进度标记
      const newLastProcessedIndex = nextIndex + currentBatchEntities.length - 1;
      PropertiesService.getScriptProperties().setProperty(SCRIPT_PROPERTY_KEY, String(newLastProcessedIndex));
      Logger.log(`[${stageName}] ✅ 本批次处理完成。已将处理进度保存到索引: ${newLastProcessedIndex}。`);
      Logger.log(`[${stageName}] 请再次运行此任务以处理下一批次。`);

      return { processed: processedInBatch, errors: 0 };

    } catch (e) {
      Logger.log(`[${stageName}] ERROR: ${e.message}\n${e.stack}`);
      return { processed: 0, errors: 1 };
    }
  },

  /**
   * [PRIVATE] 智能实体信息丰富。
   * 查找 status 为 'normalized' 或需要重新丰富的 'active' 实体。
   * ✅ [v2.0 修正] 修复了日期查询逻辑，通过分两次查询，确保能正确处理从未被丰富过（last_ai_processed_timestamp 为 null）的 active 实体。
   */
  _intelligentEntityEnrichment: async function() {
    const stageName = 'AnalysisService.Enrichment';
    let processedCount = 0;
    let errorCount = 0;

    const reEnrichIntervalDays = AnalysisService.INTELLIGENT_ENTITY_RE_ENRICH_INTERVAL_DAYS;
    const batchSize = AnalysisService.INTELLIGENT_ENTITY_BATCH_SIZE;

    if (typeof reEnrichIntervalDays !== 'number' || isNaN(reEnrichIntervalDays) || reEnrichIntervalDays < 0) {
      Logger.log(`[${stageName}] FATAL ERROR: 配置常量 INTELLIGENT_ENTITY_RE_ENRICH_INTERVAL_DAYS 无效或丢失。值: ${reEnrichIntervalDays} (类型: ${typeof reEnrichIntervalDays})`);
      return { processed: 0, errors: 1, message: "配置常量 INTELLIGENT_ENTITY_RE_ENRICH_INTERVAL_DAYS 无效" };
    }
    if (typeof batchSize !== 'number' || isNaN(batchSize) || batchSize <= 0) {
      Logger.log(`[${stageName}] FATAL ERROR: 配置常量 INTELLIGENT_ENTITY_BATCH_SIZE 无效或丢失。值: ${batchSize} (类型: ${typeof batchSize})`);
      return { processed: 0, errors: 1, message: "配置常量 INTELLIGENT_ENTITY_BATCH_SIZE 无效" };
    }

    try {
      const now = new Date();
      const reEnrichCutoff = new Date(now.getTime() - reEnrichIntervalDays * 24 * 60 * 60 * 1000);

      if (isNaN(reEnrichCutoff.getTime())) {
          Logger.log(`[${stageName}] FATAL ERROR: 计算得到的 reEnrichCutoff 是一个无效日期对象！`);
          return { processed: 0, errors: 1, message: "计算得到的截止日期无效" };
      }
      
      // --- 查询 1: 获取状态为 'normalized' 的实体 (逻辑不变) ---
      Logger.log(`[${stageName}] 查询: 状态为 'normalized' 的实体...`);
      const normalizedEntities = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
          { field: 'monitoring_status', operator: 'EQUAL', value: 'normalized' }
        ],
      });
      Logger.log(`[${stageName}] 找到 ${normalizedEntities.length} 个 'normalized' 实体。`);

      // --- ✅ [核心修正] 分两次查询 'active' 状态的实体 ---

      // --- 查询 2.1: 获取从未被丰富过的 'active' 实体 (timestamp 为 null) ---
      Logger.log(`[${stageName}] 查询: 从未被处理过 (timestamp is null) 的 'active' 实体...`);
      const activeEntitiesNeverProcessed = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
          { field: 'monitoring_status', operator: 'EQUAL', value: 'active' },
          { field: 'last_ai_processed_timestamp', operator: 'EQUAL', value: null }
        ],
      });
      Logger.log(`[${stageName}] 找到 ${activeEntitiesNeverProcessed.length} 个从未处理过的 'active' 实体。`);

      // --- 查询 2.2: 获取需要重新丰富的 'active' 实体 (timestamp 超过了截止日期) ---
      Logger.log(`[${stageName}] 查询: 需要重新丰富 (timestamp is old) 的 'active' 实体...`);
      const activeEntitiesToReEnrich = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [
          { field: 'monitoring_status', operator: 'EQUAL', value: 'active' },
          { field: 'last_ai_processed_timestamp', operator: 'LESS_THAN_OR_EQUAL', value: reEnrichCutoff }
        ],
      });
      Logger.log(`[${stageName}] 找到 ${activeEntitiesToReEnrich.length} 个需要重新丰富的 'active' 实体。`);


      // --- 合并并去重所有需要处理的实体 ---
      const uniqueEntitiesMap = new Map();
      const addEntitiesToMap = (entities) => {
        (entities || []).forEach(entity => {
          if (entity && entity.entity_id) { // 增加对实体有效性的检查
            uniqueEntitiesMap.set(entity.entity_id, entity);
          }
        });
      };

      addEntitiesToMap(normalizedEntities);
      addEntitiesToMap(activeEntitiesNeverProcessed);
      addEntitiesToMap(activeEntitiesToReEnrich);

      // 按创建时间排序，优先处理较早创建的实体，并取出一个批次
      const entitiesToEnrich = Array.from(uniqueEntitiesMap.values())
        .sort((a, b) => new Date(a.created_timestamp || 0) - new Date(b.created_timestamp || 0))
        .slice(0, batchSize);


      if (entitiesToEnrich.length === 0) {
        Logger.log(`[${stageName}] 没有待丰富或需要重新丰富的实体。`);
        return { processed: 0, errors: 0 };
      }

      Logger.log(`[${stageName}] 本次将处理 ${entitiesToEnrich.length} 个实体。`);

      const updatesToBatch = [];
      for (const entity of entitiesToEnrich) {
        // 调用辅助函数来处理单个实体的丰富逻辑
        const { success, updatedEntity, errorMessage } = await this._performSingleEntityEnrichmentLogic(entity);
        if (success) {
            updatesToBatch.push(updatedEntity);
            processedCount++;
        } else {
            // 如果单个实体处理失败，errorMessage 包含了错误信息和更新的实体（如果有的话）
            if (updatedEntity) {
              updatesToBatch.push(updatedEntity); // 即使失败也更新状态，避免循环
            }
            errorCount++;
            Logger.log(`[${stageName}] 实体 '${entity.primary_name}' (ID: ${entity.entity_id}) 丰富失败: ${errorMessage}`);
        }
      }

      if (updatesToBatch.length > 0) {
        DataService.batchUpsert('REG_ENTITIES', updatesToBatch, 'entity_id');
        Logger.log(`[${stageName}] 完成 ${processedCount} 个实体的丰富更新。`);
      }

    } catch (e) {
      Logger.log(`[${stageName}] FATAL ERROR: ${e.message}\n${e.stack}`);
      errorCount++;
    }
    return { processed: processedCount, errors: errorCount };
  },

  /**
   * [PRIVATE] 辅助函数：执行单个实体的AI丰富逻辑。
   * 该函数由 _intelligentEntityEnrichment 和手动丰富函数调用。
   * @param {object} entity - 要丰富的实体对象。
   * @returns {object} { success: boolean, updatedEntity: object|null, errorMessage: string|null }
   */
  _performSingleEntityEnrichmentLogic: async function(entity) {
    const stageName = 'AnalysisService.SingleEnrichment'; // 新的日志前缀
    const now = new Date(); // 确保时间戳一致性

    let updatedEntity = { entity_id: entity.entity_id }; // 用于存储要更新的字段
    let errorMessage = null;
    let success = false;

    // 根据实体原始状态确定处理后的新状态
    let targetStatusAfterEnrichment = 'active'; // 默认为 active (用于 re-enriched 的 active 实体)
    if (entity.monitoring_status === 'normalized' || entity.monitoring_status === 'pending_review') {
        targetStatusAfterEnrichment = 'enriched'; // 新丰富实体进入 'enriched' 待审核状态
    }


    try {
      let promptTemplateName = null;
      let promptContext = {};

      // 根据实体类型选择 AI Prompt
      switch (entity.entity_type) {
        case 'Company':
          promptTemplateName = 'entity_enrichment_company';
          promptContext = { COMPANY_NAME: entity.primary_name };
          break;
        case 'Technology':
          promptTemplateName = 'entity_enrichment_technology';
          promptContext = { TECHNOLOGY_NAME: entity.primary_name };
          break;
        case 'Person':
          promptTemplateName = 'entity_enrichment_person';
          promptContext = { PERSON_NAME: entity.primary_name };
          break;
        case 'Product':
          promptTemplateName = 'entity_enrichment_product';
          promptContext = { PRODUCT_NAME: entity.primary_name };
          break;
        case 'Financial_Concept':
          promptTemplateName = 'entity_enrichment_financial_concept';
          promptContext = { CONCEPT_NAME: entity.primary_name };
          break;
        case 'Organization_List':
          promptTemplateName = 'entity_enrichment_organization_list';
          promptContext = { LIST_NAME: entity.primary_name };
          break;
        case 'Business_Event':
          promptTemplateName = 'entity_enrichment_business_event';
          promptContext = { EVENT_NAME: entity.primary_name };
          break;
        case 'Research_Firm':
          promptTemplateName = 'entity_enrichment_research_firm';
          promptContext = { FIRM_NAME: entity.primary_name };
          break;
        case 'Publishing_Platform':
          promptTemplateName = 'entity_enrichment_publishing_platform';
          promptContext = { PLATFORM_NAME: entity.primary_name };
          break;
        default:
          errorMessage = `实体 '${entity.entity_id}' 类型 '${entity.entity_type}' 没有对应的AI丰富Prompt，跳过AI调用。`;
          Logger.log(`[${stageName}] INFO: ${errorMessage}`);
          updatedEntity = {
              entity_id: entity.entity_id,
              monitoring_status: targetStatusAfterEnrichment,
              last_ai_processed_timestamp: now,
              updated_timestamp: now,
              ai_processing_error: errorMessage
          };
          return { success: false, updatedEntity: updatedEntity, errorMessage: errorMessage };
      }

      Logger.log(`[${stageName}] 为实体 '${entity.primary_name}' (类型: ${entity.entity_type}) 调用 AI 丰富 (Prompt: ${promptTemplateName})...`);
      const aiResult = await DataConnector.getBatchCompletions(PromptLibrary.get(promptTemplateName), promptContext);

      if (aiResult) {
        // 将AI结果合并到updatedEntity
        Object.assign(updatedEntity, aiResult);
        updatedEntity.monitoring_status = targetStatusAfterEnrichment;
        updatedEntity.last_ai_processed_timestamp = now;
        updatedEntity.updated_timestamp = now;
        updatedEntity.ai_processing_error = null; // 清除之前的错误信息

        // 对于 Technology 实体，如果 AI 返回了 search_keywords，则明确移除旧的 tech_keywords
        if (entity.entity_type === 'Technology' && updatedEntity.search_keywords) {
            updatedEntity.tech_keywords = null;
        }

        // 清理空字符串和空数组，转换为 null
        for (const key in updatedEntity) {
            if (typeof updatedEntity[key] === 'string' && updatedEntity[key].trim() === '') {
                updatedEntity[key] = null;
            } else if (Array.isArray(updatedEntity[key]) && updatedEntity[key].length === 0) {
                updatedEntity[key] = null;
            }
        }

        // ✅ [新增] 链接制造商ID的逻辑
        if (entity.entity_type === 'Product' && updatedEntity.manufacturer_name) {
          // 这里我们不能直接用 ProcessingService, 而是应该获取字典
          // 为了简单起见，我们假设一个全局函数可以获取字典，或者在这里重新构建它
          // 简化版：直接在 AnalysisService 中获取
          const allEntitiesForDict = DataService.getDataAsObjects('REG_ENTITIES');
          const companyDict = new Map();
          allEntitiesForDict.filter(e => e.entity_type === 'Company').forEach(c => {
              companyDict.set(c.primary_name.trim().toLowerCase(), c.entity_id);
              (c.aliases || []).forEach(alias => companyDict.set(String(alias).trim().toLowerCase(), c.entity_id));
          });

          const manuName = updatedEntity.manufacturer_name.trim().toLowerCase();
          if (companyDict.has(manuName)) {
              updatedEntity.manufacturer_id = companyDict.get(manuName);
          } else {
              Logger.log(`[${stageName}] WARN: Could not find entity ID for manufacturer: ${updatedEntity.manufacturer_name}`);
          }
          delete updatedEntity.manufacturer_name; // 删除临时的名称字段，只保留ID
        }
        
        success = true;
      } else {
        errorMessage = `AI 未为实体 '${entity.primary_name}' 返回丰富数据。`;
        Logger.log(`[${stageName}] WARN: ${errorMessage}`);
        updatedEntity.monitoring_status = targetStatusAfterEnrichment;
        updatedEntity.last_ai_processed_timestamp = now;
        updatedEntity.updated_timestamp = now;
        updatedEntity.ai_processing_error = errorMessage;
        success = false;
      }
    } catch (innerError) {
      errorMessage = `丰富实体 '${entity.primary_name}' (ID: ${entity.entity_id}) 时发生错误: ${innerError.message}\n${innerError.stack}`;
      Logger.log(`[${stageName}] ERROR: ${errorMessage}`);
      updatedEntity.monitoring_status = targetStatusAfterEnrichment; // 即使失败也更新状态，避免循环重试
      updatedEntity.last_ai_processed_timestamp = now;
      updatedEntity.updated_timestamp = now;
      updatedEntity.ai_processing_error = innerError.message.substring(0, 500); // 截断错误信息
      success = false;
    }
    return { success: success, updatedEntity: updatedEntity, errorMessage: errorMessage };
  },

  RELATIONSHIP_BATCH_SIZE: 50, // 每次获取并处理的信号数量
  RELATIONSHIP_WRITE_CHUNK_SIZE: 25, // 每处理10个信号就写入一次

  /**
   * [Workflow] 构建实体间的语义关系。
   * 扫描状态为 'SIGNAL_IDENTIFIED' 的发现，利用AI提炼实体间的显式关系，并写入 'KG_EDGES' 集合。
   */
  runRelationshipWorkflow: async function() {
    const jobName = 'AnalysisService.runRelationshipWorkflow';
    Logger.log(`[${jobName}] --- 开始执行关系构建工作流 ---`);
    let errorCount = 0;
    let newRelationshipCount = 0;
    let updatedRelationshipCount = 0;

    // **新增：用于收集本次运行中所有要写入/更新的关系和信号状态的临时变量**
    const currentRelationshipsToUpsert = new Map(); // 用于收集当前写入批次的关系
    const currentFindingsToUpdate = [];             // 用于收集当前写入批次的信号状态

    // **辅助函数：执行分批写入**
    const executeBatchWrites = async () => {
        if (currentRelationshipsToUpsert.size > 0) {
            await DataService.batchUpsert('KG_EDGES', Array.from(currentRelationshipsToUpsert.values()), 'id');
            Logger.log(`[${jobName}] 分批写入 ${currentRelationshipsToUpsert.size} 个关系。`);
            currentRelationshipsToUpsert.clear(); // 清空，为下一批准备
        }
        if (currentFindingsToUpdate.length > 0) {
            await DataService.batchUpsert('FND_MASTER', currentFindingsToUpdate, 'id');
            Logger.log(`[${jobName}] 分批更新 ${currentFindingsToUpdate.length} 个信号状态。`);
            currentFindingsToUpdate.length = 0; // 清空数组
        }
    };

    try {
      const findingsToProcess = DataService.getDataAsObjects('FND_MASTER', {
        filters: [
          { field: 'finding_status', operator: 'EQUAL', value: 'SIGNAL_IDENTIFIED' }
        ],
        limit: this.RELATIONSHIP_BATCH_SIZE
      });

      if (!findingsToProcess || findingsToProcess.length === 0) {
        Logger.log(`[${jobName}] 没有需要构建关系的“发现”，任务结束。`);
        return;
      }
      
      Logger.log(`[${jobName}] 找到 ${findingsToProcess.length} 个待处理的信号，本次将处理它们。`);

      const dictionaries = ProcessingService._getEntityDictionaries();
      const idToNameMap = new Map();
      Object.values(dictionaries).forEach(dict => {
        dict.forEach((id, name) => {
          if (!idToNameMap.has(id)) idToNameMap.set(id, name);
        });
      });

      // **主要循环**
      for (let i = 0; i < findingsToProcess.length; i++) {
        const finding = findingsToProcess[i];
        try {
          const uniqueEntities = [...new Set(finding.linked_entity_ids || [])];
          if (uniqueEntities.length < 2) {
            Logger.log(`[${jobName}] 信号 '${finding.id}' 实体数量不足 (${uniqueEntities.length})，跳过关系构建。`);
            currentFindingsToUpdate.push({ id: finding.id, finding_status: 'ANALYZED' }); // 推入当前批次
            continue;
          }
          
          const entityListForAI = uniqueEntities.map(id => ({ id: id, name: idToNameMap.get(id) || id }));
          const textToAnalyze = `标题：${finding.title}\n摘要：${finding.ai_summary || finding.summary}`;
          
          Logger.log(`[${jobName}] 为信号 '${finding.id}' 调用AI进行语义关系抽取...`);
          const aiResult = await DataConnector.getBatchCompletions(PromptLibrary.get('relationship_extraction'), {
              ENTITY_LIST_JSON: JSON.stringify(entityListForAI),
              TEXT_TO_ANALYZE: textToAnalyze
          });

          if (aiResult && aiResult.extracted_relationships && Array.isArray(aiResult.extracted_relationships)) {
            for (const rel of aiResult.extracted_relationships) {
                if (!rel.source_id || !rel.target_id || !rel.type || !rel.strength) {
                    Logger.log(`[${jobName}] WARN: 信号 '${finding.id}' 提取到不完整关系：${JSON.stringify(rel)}`);
                    continue;
                }
                
                if (rel.source_id === rel.target_id) continue;

                const sortedIds = [rel.source_id, rel.target_id].sort();
                const relationshipId = `rel_${sortedIds[0]}_${rel.type}_${sortedIds[1]}`;

                // **从内存中获取或从 Firestore 读取**
                let existingRel = currentRelationshipsToUpsert.get(relationshipId); // 优先从当前批次 Map 中找
                if (!existingRel) { // 如果当前批次 Map 中没有，再从 Firestore 读
                    existingRel = DataService.getDocument('KG_EDGES', relationshipId);
                }

                if (existingRel) {
                  const totalOccurrences = (existingRel.occurrence_count || 0) + 1;
                  existingRel.strength_score = (((existingRel.strength_score || 0) * (existingRel.occurrence_count || 0)) + rel.strength) / totalOccurrences;
                  if (!existingRel.supporting_finding_ids.includes(finding.id)) {
                      existingRel.supporting_finding_ids.push(finding.id);
                  }
                  existingRel.occurrence_count = totalOccurrences;
                  existingRel.last_seen_timestamp = new Date();
                  updatedRelationshipCount++;
                  currentRelationshipsToUpsert.set(relationshipId, existingRel); // 更新到内存 Map
                  Logger.log(`[${jobName}] 更新关系: ${relationshipId}`);
                } else {
                  const newRel = {
                      id: relationshipId,
                      source_entity_id: sortedIds[0],
                      target_entity_id: sortedIds[1],
                      relationship_type: rel.type,
                      strength_score: rel.strength,
                      description: rel.description,
                      supporting_finding_ids: [finding.id],
                      occurrence_count: 1,
                      first_seen_timestamp: new Date(),
                      last_seen_timestamp: new Date()
                  };
                  newRelationshipCount++;
                  currentRelationshipsToUpsert.set(relationshipId, newRel); // 添加到内存 Map
                  Logger.log(`[${jobName}] 创建新关系: ${relationshipId}`);
                }
            }
          } else {
              Logger.log(`[${jobName}] WARN: 信号 '${finding.id}' AI未提取到有效关系。AI返回: ${JSON.stringify(aiResult)}`);
          }
          
          currentFindingsToUpdate.push({ id: finding.id, finding_status: 'ANALYZED' }); // 推入当前批次

        } catch (innerError) {
          errorCount++;
          Logger.log(`[${jobName}] ERROR: 处理信号 '${finding.id}' 时发生错误: ${innerError.message}\n${innerError.stack}`);
          currentFindingsToUpdate.push({ id: finding.id, finding_status: 'ANALYSIS_FAILED' }); // 推入当前批次
        }

        // **核心优化：达到写入批次大小，执行一次批量写入**
        if ((i + 1) % this.RELATIONSHIP_WRITE_CHUNK_SIZE === 0 || (i + 1) === findingsToProcess.length) {
            Logger.log(`[${jobName}] 达到写入批次大小或处理完所有信号，执行分批写入...`);
            await executeBatchWrites();
        }
      } // End of for loop

      // **确保最后一次批量写入已执行** (如果循环结束时没有达到WRITE_CHUNK_SIZE的整数倍)
      // 实际上 executeBatchWrites 已经在 if 语句中处理了，这里可以省略，但保留更安全
      await executeBatchWrites();
      
      Logger.log(`[${jobName}] --- 工作流结束。处理了 ${findingsToProcess.length} 个信号。新建关系: ${newRelationshipCount}，更新关系: ${updatedRelationshipCount}，发生错误: ${errorCount}。`);

    } catch (e) {
      Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

  // **新增一个配置常量，用于控制每次技术树构建的批次大小**
  HIERARCHY_BATCH_SIZE: 10, // 每次处理10个孤儿技术

  /**
   * [Workflow] 构建技术实体的层级树。
   */
  runHierarchyWorkflow: async function() {
    const jobName = 'AnalysisService.runHierarchyWorkflow';
    Logger.log(`[${jobName}] --- 开始执行技术树构建工作流 ---`);
    let successCount = 0;
    let errorCount = 0;

    try {
        // **优化1：只获取需要进行层级分类的孤儿技术，并限制批次大小**
        // filters: 查找 entity_type 为 'Technology' 且 parent_id 为 null 的实体
        // limit: 限制每次运行处理的孤儿技术数量
        const orphanTechs = DataService.getDataAsObjects('REG_ENTITIES', {
            filters: [
                { field: 'entity_type', operator: 'EQUAL', value: 'Technology' },
                { field: 'parent_id', operator: 'EQUAL', value: null } // 查找 parent_id 为 null 的
            ],
            limit: this.HIERARCHY_BATCH_SIZE // 限制每次运行处理的数量
        });

        if (!orphanTechs || orphanTechs.length === 0) {
            Logger.log(`[${jobName}] 没有待分类的孤儿技术实体。任务结束。`);
            return { success: 0, errors: 0 }; // 返回处理结果
        }

        Logger.log(`[${jobName}] 找到 ${orphanTechs.length} 个待分类的孤儿技术实体，本次将处理它们。`);

        // **优化2：一次性获取所有 Technology 实体作为候选父类别，避免在循环中重复查询**
        const allTechs = DataService.getDataAsObjects('REG_ENTITIES', {
            filters: [{ field: 'entity_type', operator: 'EQUAL', value: 'Technology' }]
        });
        const candidateParents = allTechs.filter(t => t.parent_id); // 过滤出已经有父ID的作为候选父类别
        const candidateParentsForAI = candidateParents.map(p => ({ id: p.entity_id, name: p.primary_name, summary: p.description || '' }));
        Logger.log(`[${jobName}] 找到 ${candidateParents.length} 个候选父类别。`);


        const updatesToBatch = [];
        for (const orphan of orphanTechs) { // 遍历本次批次处理的孤儿技术
            try {
                Logger.log(`[${jobName}] 为孤儿技术 '${orphan.primary_name}' (ID: ${orphan.entity_id}) 调用 AI 进行层级分类...`);
                const aiResult = await DataConnector.getBatchCompletions(PromptLibrary.get('technology_hierarchy_classification'), {
                    TECH_NAME: orphan.primary_name,
                    TECH_SUMMARY: orphan.description || 'No summary available.',
                    CANDIDATE_PARENTS_JSON: JSON.stringify(candidateParentsForAI)
                });

                if (aiResult && aiResult.parent_id) {
                    updatesToBatch.push({
                        entity_id: orphan.entity_id,
                        parent_id: aiResult.parent_id,
                        updated_timestamp: new Date()
                    });
                    successCount++;
                    Logger.log(`[${jobName}] 成功分类孤儿技术 '${orphan.primary_name}'，父ID: ${aiResult.parent_id}`);
                } else {
                    Logger.log(`[${jobName}] WARN: AI 未能为孤儿技术 '${orphan.primary_name}' 找到合适的父类别。AI返回: ${JSON.stringify(aiResult)}`);
                    // 即使AI没找到，也更新时间戳，避免下次反复处理同一个
                    updatesToBatch.push({
                        entity_id: orphan.entity_id,
                        updated_timestamp: new Date(),
                        ai_hierarchy_error: 'AI did not find a parent or returned invalid format'
                    });
                    errorCount++;
                }
            } catch (innerError) {
                errorCount++;
                Logger.log(`[${jobName}] ERROR: 处理孤儿技术 ${orphan.entity_id} 时发生错误: ${innerError.message}\n${innerError.stack}`);
                updatesToBatch.push({
                    entity_id: orphan.entity_id,
                    updated_timestamp: new Date(),
                    ai_hierarchy_error: innerError.message.substring(0, 500)
                });
            }
        }

        if (updatesToBatch.length > 0) {
            DataService.batchUpsert('REG_ENTITIES', updatesToBatch, 'entity_id');
            Logger.log(`[${jobName}] 批量更新了 ${updatesToBatch.length} 个技术实体的父ID。`);
        }
        Logger.log(`[${jobName}] --- 工作流结束。处理了 ${orphanTechs.length} 个孤儿技术。成功分类: ${successCount}，失败: ${errorCount}。`);
        return { success: successCount, errors: errorCount }; // 返回处理结果
    } catch (e) {
      Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
      return { success: 0, errors: 1 }; // 返回处理结果
    }
  },

  /**
   * [Workflow] 生成实体每日分析快照。
   */
    /**
   * [Workflow] 生成实体每日分析快照。
   */
  runSnapshotWorkflow: function() {
    const jobName = 'AnalysisService.runSnapshotWorkflow';
    Logger.log(`[${jobName}] --- 开始执行每日实体快照生成工作流 ---`);
    let successCount = 0;
    let errorCount = 0;

    try {
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        const todayEnd = new Date();
        const todayStr = DateUtils.formatDate(todayEnd);

        const todayFindings = DataService.getDataAsObjects('FND_MASTER', {
            filters: [{ field: 'created_timestamp', operator: 'GREATER_THAN_OR_EQUAL', value: todayStart }]
        });

        const insightsByEntity = {};
        todayFindings.forEach(finding => {
            (finding.linked_entity_ids || []).forEach(entityId => {
                if (!insightsByEntity[entityId]) insightsByEntity[entityId] = [];
                insightsByEntity[entityId].push(finding);
            });
        });

        const entityIdsToProcess = Object.keys(insightsByEntity);
        if (entityIdsToProcess.length === 0) {
            Logger.log(`[${jobName}] 今日无实体有新动态，无需生成快照。`);
            return;
        }
        
        const dailyStatsToUpsert = [];
        for (const entityId of entityIdsToProcess) {
            try {
                const relatedFindings = insightsByEntity[entityId] || [];
                
                const marketAttentionScore = relatedFindings.reduce((sum, f) => sum + (f.signal_strength_score || 5), 0);
                
                // ✅ [核心修正] 使用辅助函数获取正确的任务类型进行筛选
                const innovationActivityScore = relatedFindings.filter(f => {
                    const taskType = this._getTaskTypeFromFinding(f); // 调用内部辅助函数
                    return ['ACADEMIC_PAPER', 'PATENT', 'OPENSOURCE'].includes(taskType);
                }).reduce((sum, f) => sum + (f.signal_strength_score || 5), 0);
                
                // ✅ [核心修正] 使用辅助函数获取正确的任务类型进行筛选
                const talentDemandScore = relatedFindings.filter(f => {
                    const taskType = this._getTaskTypeFromFinding(f); // 调用内部辅助函数
                    return taskType === 'TALENT_FLOW';
                }).length * 10;
                
                const influenceScore = (marketAttentionScore * 0.5) + (innovationActivityScore * 0.4) + (talentDemandScore * 0.1);

                const snapshot = {
                    id: `${entityId}_${todayStr}`,
                    entity_id: entityId,
                    snapshot_date: todayStr,
                    influence_score: Math.min(Math.round(influenceScore), 100),
                    market_attention_score: Math.min(Math.round(marketAttentionScore), 100),
                    innovation_activity_score: Math.min(Math.round(innovationActivityScore), 100),
                    talent_demand_score: Math.min(Math.round(talentDemandScore), 100),
                    related_findings_count: relatedFindings.length,
                    created_timestamp: new Date()
                };
                dailyStatsToUpsert.push(snapshot);
                successCount++;
            } catch (innerError) {
                errorCount++;
                Logger.log(`[${jobName}] ERROR: 处理实体 ${entityId} 时发生错误: ${innerError.message}`);
            }
        }

        if (dailyStatsToUpsert.length > 0) {
            DataService.batchUpsert('ANL_DAILY_SNAPSHOTS', dailyStatsToUpsert, 'id');
        }
        Logger.log(`[${jobName}] --- 工作流结束。处理了 ${entityIdsToProcess.length} 个实体。成功生成 ${successCount} 条快照，失败 ${errorCount} 条。`);
    } catch (e) {
        Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

  //==================================================================
  // SECTION 2: 前端API方法 (由Main.gs -> callApi调用)
  //==================================================================
  
  /**
   * [API] 为前端提供关系网络图数据。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} focusedEntityId - 聚焦实体ID (可选)
   * @returns {object} { nodes: [], links: [] }
   */
  // ✅ [修正] 添加 authInfo 参数
  getNetworkGraph: function(authInfo, focusedEntityId = null) {
    let allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
    let allRelationships = DataService.getDataAsObjects('KG_EDGES') || [];

    let filteredEntities = allEntities;
    let filteredRelationships = allRelationships;

    if (focusedEntityId) {
        const focusSet = new Set([focusedEntityId]);
        filteredRelationships = allRelationships.filter(r => focusSet.has(r.source_entity_id) || focusSet.has(r.target_entity_id));
        const relatedIds = new Set(filteredRelationships.flatMap(r => [r.source_entity_id, r.target_entity_id]));
        relatedIds.add(focusedEntityId);
        filteredEntities = allEntities.filter(e => relatedIds.has(e.entity_id));
    }

    const nodes = filteredEntities.map(e => ({
        id: e.entity_id,
        name: e.primary_name,
        type: e.entity_type,
        category: e.entity_type,
        value: e.relevance_score || e.impact_score || 50,
    }));

    const links = filteredRelationships.map(r => ({
        source: r.source_entity_id,
        target: r.target_entity_id,
        type: r.relationship_type,
        strength: r.strength_score,
        description: r.description,
        type_label: r.relationship_type
    }));

    return { nodes, links };
  },

  /**
   * [API] 为前端获取实体基本信息。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} entityId - 实体ID
   * @returns {object} { id, name, type }
   */
  // ✅ [修正] 添加 authInfo 参数
  getEntityInfo: function(authInfo, entityId) {
    const entity = DataService.getDocument('REG_ENTITIES', entityId);
    if (!entity) return null;

    return {
      id: entity.entity_id,
      name: entity.primary_name,
      type: entity.entity_type,
      image_url: entity.image_url || null
    };
  },

  /**
   * [API] 为前端的实体详情面板提供聚合数据。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} elementId - 实体或关系的ID
   * @returns {object} { name, type, summary, details, evidence: [{title, url}] }
   */
  // ✅ [修正] 添加 authInfo 参数
  getElementDetails: function(authInfo, elementId) {
    let entity = DataService.getDocument('REG_ENTITIES', elementId);
    if (entity) {
        const relatedFindings = DataService.getDataAsObjects('FND_MASTER', {
            filters: [{ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: entity.entity_id }],
            orderBy: { field: 'created_timestamp', direction: 'DESCENDING' },
            limit: 5
        });
        const evidence = (relatedFindings || []).map(f => ({
            title: f.title,
            url: f.url || `#findings/${f.id}`
        }));

        return {
            name: entity.primary_name,
            type: entity.entity_type,
            summary: entity.description || '暂无摘要信息。',
            details: `类别: ${entity.category || 'N/A'}<br/>子类别: ${entity.sub_type || 'N/A'}` +
                     (entity.website ? `<br/>官网: <a href="${entity.website}" target="_blank" class="text-primary hover:underline">${entity.website}</a>` : '') +
                     (entity.headquarters ? `<br/>总部: ${entity.headquarters}` : '') +
                     (entity.founding_year ? `<br/>成立年份: ${entity.founding_year}` : '') +
                     (entity.stock_symbol ? `<br/>股票代码: ${entity.stock_symbol}` : '') +
                     (entity.search_keywords && entity.search_keywords.length > 0 ? `<br/>搜索关键词: ${entity.search_keywords.join(', ')}` : ''),
            evidence: evidence
        };
    }

    let relationship = DataService.getDocument('KG_EDGES', elementId);
    if (relationship) {
        const sourceEntity = DataService.getDocument('REG_ENTITIES', relationship.source_entity_id);
        const targetEntity = DataService.getDocument('REG_ENTITIES', relationship.target_entity_id);
        
        return {
            name: `${sourceEntity?.primary_name || relationship.source_entity_id} - ${relationship.relationship_type} -> ${targetEntity?.primary_name || relationship.target_entity_id}`,
            type: `关系 (${relationship.relationship_type})`,
            summary: relationship.description || '暂无描述。',
            details: `强度: ${relationship.strength_score || 'N/A'}<br/>
                      首次发现: ${DateUtils.formatDate(relationship.first_seen_timestamp) || 'N/A'}<br/>
                      最近发现: ${DateUtils.formatDate(relationship.last_seen_timestamp) || 'N/A'}<br/>
                      支持发现数量: ${relationship.occurrence_count || 0}`,
            evidence: (relationship.supporting_finding_ids || []).map(id => ({
                title: `支持信号: ${id}`,
                url: `#findings/${id}`
            }))
        };
    }

    return null;
  },

  /**
   * [API] 为前端提供趋势分析数据 (演进推演)。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} entityId - 实体ID
   * @returns {object} { trendData: [{date, influence, attention}], timelineEvents: [{date, lane, title, description}] }
   */
  // ✅ [修正] 添加 authInfo 参数
  getEvolutionData: function(authInfo, entityId) {
    const snapshots = DataService.getDataAsObjects('ANL_DAILY_SNAPSHOTS', {
        filters: [{ field: 'entity_id', operator: 'EQUAL', value: entityId }],
        orderBy: { field: 'snapshot_date', direction: 'ASCENDING' },
        limit: 365
    });

    const trendData = (snapshots || []).map(s => ({
        date: DateUtils.formatDate(s.snapshot_date),
        influence: s.influence_score || 0,
        attention: s.market_attention_score || 0
    }));

    const timelineFindings = DataService.getDataAsObjects('FND_MASTER', {
        filters: [
            { field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: entityId },
            { field: 'ai_value_score', operator: 'GREATER_THAN_OR_EQUAL', value: 8 }
        ],
        orderBy: { field: 'publication_timestamp', direction: 'DESCENDING' },
        limit: 10
    });

    const timelineEvents = (timelineFindings || []).map(f => ({
        date: DateUtils.formatDate(f.publication_timestamp),
        lane: f.task_type === 'ACADEMIC_PAPER' ? '技术' : (f.task_type === 'TECH_NEWS' ? '市场' : '其他'),
        title: f.title,
        summary: f.ai_summary || f.summary
    }));

    return { trendData, timelineEvents };
  },
  
  /**
   * [API] 为前端提供生态位分析数据。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} entityId - 目标实体ID
   * @param {string[]} competitorIds - 竞争对手实体ID列表
   * @returns {object} { radarData, matrixData, swot }
   */
  // ✅ [修正] 添加 authInfo 参数
  getEcosystemData: function(authInfo, entityId, competitorIds = []) {
    const targetEntity = DataService.getDocument('REG_ENTITIES', entityId);
    if (!targetEntity) {
        return { radarData: {}, matrixData: [], swot: {} };
    }

    const getRadarValues = (entity) => {
        const innovation = entity.impact_score || Math.floor(Math.random() * 50) + 50;
        const marketShare = Math.floor(Math.random() * 50) + 50;
        const talentDensity = Math.floor(Math.random() * 50) + 50;
        const capitalStrength = Math.floor(Math.random() * 50) + 50;
        const ecosystemBuilding = Math.floor(Math.random() * 50) + 50;
        return [innovation, marketShare, talentDensity, capitalStrength, ecosystemBuilding];
    };

    const radarIndicator = [
        { name: '技术创新', max: 100 }, { name: '市场份额', max: 100 },
        { name: '人才密度', max: 100 }, { name: '资本实力', max: 100 },
        { name: '生态建设', max: 100 }
    ];

    const radarSeries = [];
    radarSeries.push({
        value: getRadarValues(targetEntity),
        name: targetEntity.primary_name
    });

    const radarData = {
        indicator: radarIndicator,
        series: radarSeries
    };

    const matrixData = [];
    const keywords = Helpers.getSearchKeywordsForEntity(targetEntity);
    keywords.slice(0, 5).forEach((kw, index) => {
        matrixData.push([
            Math.floor(Math.random() * 50) + 50,
            Math.floor(Math.random() * 50) + 50,
            Math.floor(Math.random() * 50) + 50,
            kw
        ]);
    });

    let swot = {
        strengths: [`${targetEntity.primary_name} 在 ${targetEntity.category || '其领域'} 具有强大的品牌影响力。`],
        weaknesses: [`${targetEntity.primary_name} 在 ${targetEntity.sub_type || '某些领域'} 可能存在短板。`],
        opportunities: [`${targetEntity.primary_name} 在新兴市场有巨大增长潜力。`],
        threats: [`来自竞争对手的压力日益增大。`]
    };

    return { radarData, matrixData, swot };
  },

  /**
   * [API] 为前端提供趋势分析数据。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  // ✅ [修正] 添加 authInfo 参数
  getTrendAnalysis: function(authInfo, entityId, timeRange = '30d') {
    const endDate = new Date();
    const startDate = new Date();
    const days = parseInt(timeRange.replace('d','')) || 30;
    startDate.setDate(endDate.getDate() - days);

    const filters = [
      { field: 'entity_id', operator: 'EQUAL', value: entityId },
      { field: 'snapshot_date', operator: 'GREATER_THAN_OR_EQUAL', value: DateUtils.formatDate(startDate) }
    ];
    
    const snapshots = DataService.getDataAsObjects('ANL_DAILY_SNAPSHOTS', { 
        filters,
        orderBy: {field: 'snapshot_date', direction: 'ASCENDING'}
    });
    
    const dates = snapshots.map(s => s.snapshot_date);
    const scores = snapshots.map(s => s.influence_score);
    return { dates, scores };
  },
  
  /**
   * [API] 为前端的实体详情面板提供聚合数据。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  // ✅ [修正] 添加 authInfo 参数
  getEntityDetails: function(authInfo, entityId) {
    const entity = DataService.getDocument('REG_ENTITIES', entityId);
    if (!entity) return { error: `未找到实体: ${entityId}`};

    const findings = DataService.getDataAsObjects('FND_MASTER', {
        filters: [{ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: entityId }],
        orderBy: { field: 'signal_strength_score', direction: 'DESCENDING' },
        limit: 10
    });

    return {
        name: entity.primary_name,
        summary: entity.description || '暂无摘要信息。',
        type: entity.entity_type,
        relatedFindings: findings.map(f => ({
            id: f.id,
            title: f.title,
            date: DateUtils.formatDate(f.created_timestamp),
            score: f.signal_strength_score
        }))
    };
  }
};
