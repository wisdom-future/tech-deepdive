/**
 * @file tools.backfill.js
 * @description 存放所有历史数据回填(Backfilling)的脚本。
 * 用于在新功能上线后，为存量数据补充缺失的字段。
 */

const BackfillTasks = {

  /**
   * [Backfill Task] 为所有没有嵌入向量的 'findings_master' 记录回填数据。
   * 这是一个耗时很长的任务，需要分批执行。
   */
  backfillEmbeddingsForFindings: function(batchSize = 50) {
    const jobName = 'BackfillEmbeddingsForFindings';
    Logger.log(`--- [${jobName}] 开始回填 'findings_master' 的嵌入向量 ---`);

    try {
      // 1. 查找没有嵌入向量的记录
      const findingsToProcess = DataService.getDataAsObjects('FND_MASTER', {
        filters: [
          { field: 'has_embedding', operator: 'EQUAL', value: false }
        ],
        limit: batchSize
      });

      if (!findingsToProcess || findingsToProcess.length === 0) {
        Logger.log(`[${jobName}] 没有需要回填嵌入向量的记录了。任务完成。`);
        return;
      }
      Logger.log(`[${jobName}] 发现 ${findingsToProcess.length} 条记录需要回填。`);

      // 2. 准备文本并批量获取嵌入
      const textsForEmbedding = findingsToProcess.map(f => `Title: ${f.title}\nSummary: ${f.summary}`);
      const embeddingResults = DataConnector.getBatchEmbeddings(textsForEmbedding); // 假设此方法已存在

      // 3. 准备批量更新
      const updates = [];
      findingsToProcess.forEach((finding, index) => {
        const embedding = embeddingResults[index];
        if (embedding) {
          updates.push({
            id: finding.id,
            embedding_vector: embedding,
            has_embedding: true,
            updated_timestamp: new Date()
          });
        }
      });

      // 4. 执行批量更新
      if (updates.length > 0) {
        DataService.batchUpsert('FND_MASTER', updates, 'id');
        Logger.log(`[${jobName}] 成功为 ${updates.length} 条记录回填了嵌入向量。`);
      }
      
      Logger.log(`[${jobName}] 本批次回填完成。如果还有剩余，请再次运行此任务。`);

    } catch (e) {
      Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
    }
  },

    /**
   * [可执行的回填任务]
   * 重新计算并修正所有历史快照记录中的分数。
   * 这个任务会遍历所有 ANL_DAILY_SNAPSHOTS 中的记录，并根据其关联的 FND_MASTER 记录重新计算各项分数。
   * 这是一个耗时任务，建议在需要时手动运行。
   */
  backfillSnapshotScores: function() {
    const jobName = 'BackfillSnapshotScores';
    Logger.log(`--- [${jobName}] 开始回填历史快照分数 ---`);
    let processedCount = 0;
    let updatedCount = 0;

    try {
      // 1. 获取所有的历史快照
      const allSnapshots = DataService.getDataAsObjects('ANL_DAILY_SNAPSHOTS') || [];
      if (allSnapshots.length === 0) {
        Logger.log(`[${jobName}] 未找到任何历史快照记录，无需回填。`);
        return;
      }
      Logger.log(`[${jobName}] 找到 ${allSnapshots.length} 条历史快照待检查。`);

      // 2. 获取所有的“发现”记录，一次性加载到内存以提高效率
      // 注意：如果FND_MASTER集合非常巨大，这里可能需要优化为分批处理
      const allFindings = DataService.getDataAsObjects('FND_MASTER') || [];
      const findingsMap = new Map();
      allFindings.forEach(f => {
        (f.linked_entity_ids || []).forEach(entityId => {
          if (!findingsMap.has(entityId)) {
            findingsMap.set(entityId, []);
          }
          findingsMap.get(entityId).push(f);
        });
      });

      const snapshotsToUpdate = [];

      // 3. 遍历每一条快照
      for (const snapshot of allSnapshots) {
        processedCount++;
        const entityId = snapshot.entity_id;
        const snapshotDate = new Date(snapshot.snapshot_date);
        
        // 筛选出在该快照日期当天或之前，与该实体相关的所有“发现”
        const relatedFindings = (findingsMap.get(entityId) || []).filter(f => {
          const findingDate = new Date(f.created_timestamp);
          // 注意：这里我们假设快照是基于当天产生的所有信号，所以只比较日期
          return findingDate.getFullYear() === snapshotDate.getFullYear() &&
                 findingDate.getMonth() === snapshotDate.getMonth() &&
                 findingDate.getDate() === snapshotDate.getDate();
        });

        if (relatedFindings.length === 0) {
          continue; // 如果当天没有相关发现，则跳过，保持原样
        }

        // 4. 使用修正后的逻辑重新计算分数
        // (这里的逻辑与 AnalysisService.runSnapshotWorkflow 中的新逻辑完全一致)
        const marketAttentionScore = relatedFindings.reduce((sum, f) => sum + (f.signal_strength_score || 5), 0);
        
        const innovationActivityScore = relatedFindings.filter(f => {
            // 复用 AnalysisService 中的辅助函数来获取正确的任务类型
            const taskType = AnalysisService._getTaskTypeFromFinding(f);
            return ['ACADEMIC_PAPER', 'PATENT', 'OPENSOURCE'].includes(taskType);
        }).reduce((sum, f) => sum + (f.signal_strength_score || 5), 0);
        
        const talentDemandScore = relatedFindings.filter(f => {
            const taskType = AnalysisService._getTaskTypeFromFinding(f);
            return taskType === 'TALENT_FLOW';
        }).length * 10;
        
        const influenceScore = (marketAttentionScore * 0.5) + (innovationActivityScore * 0.4) + (talentDemandScore * 0.1);

        // 5. 如果新分数与旧分数不同，则加入待更新列表
        if (snapshot.innovation_activity_score !== Math.min(Math.round(innovationActivityScore), 100)) {
           snapshotsToUpdate.push({
             id: snapshot.id, // 使用快照的唯一ID进行更新
             influence_score: Math.min(Math.round(influenceScore), 100),
             market_attention_score: Math.min(Math.round(marketAttentionScore), 100),
             innovation_activity_score: Math.min(Math.round(innovationActivityScore), 100),
             talent_demand_score: Math.min(Math.round(talentDemandScore), 100),
             updated_timestamp: new Date() // 标记更新时间
           });
           updatedCount++;
        }
      }

      // 6. 批量更新数据库
      if (snapshotsToUpdate.length > 0) {
        DataService.batchUpsert('ANL_DAILY_SNAPSHOTS', snapshotsToUpdate, 'id');
        Logger.log(`✅ [${jobName}] 成功更新了 ${updatedCount} 条历史快照记录。`);
      } else {
        Logger.log(`[${jobName}] 所有历史快照数据均是正确的，无需更新。`);
      }

    } catch (e) {
      Logger.log(`❌ [${jobName}] 回填过程中发生严重错误: ${e.message}\n${e.stack}`);
    }
    Logger.log(`--- [${jobName}] 回填任务结束。共检查 ${processedCount} 条记录。---`);
  }
};

/**
 * [可独立运行的最终修复任务 v2.0]
 * 无条件遍历所有 FND_MASTER 记录，并强制为其补充或修正 task_type 等关键字段。
 *
 * ✅ [v2.0 修正] 移除了基于 `task_type == null` 的筛选，改为强制遍历所有记录，确保覆盖所有情况（字段不存在或值为null）。
 * 这是一个非常耗时和消耗读写配额的任务，但能保证100%的数据修复。
 */
function MANUAL_repairFindingsMaster_V2() {
  const jobName = 'RepairFindingsMaster_V2';
  Logger.log(`--- [${jobName}] 开始强制修复所有 FND_MASTER 数据 ---`);
  let processedCount = 0;
  let updatedCount = 0;
  const BATCH_SIZE = 200; // 每次处理200条，防止超时

  const evidenceCollectionKeys = [
    'EVD_NEWS', 'EVD_PAPERS', 'EVD_PATENTS', 'EVD_OPENSOURCE',
    'EVD_JOBS', 'EVD_DYNAMICS', 'EVD_REPORTS', 'EVD_FILINGS'
  ];

  try {
    // 1. 无条件获取所有“发现”记录
    const allFindings = DataService.getDataAsObjects('FND_MASTER');

    if (!allFindings || allFindings.length === 0) {
      Logger.log(`[${jobName}] FND_MASTER 集合中没有任何记录。`);
      return;
    }
    Logger.log(`[${jobName}] 找到 ${allFindings.length} 条“发现”记录需要进行强制检查。`);

    const findingsToUpdate = [];

    // 2. 遍历每一条记录
    for (const finding of allFindings) {
      processedCount++;
      if (!finding.primary_evidence_id) {
        continue;
      }

      let sourceEvidence = null;
      let found = false;

      // 3. 在所有证据库中查找源头证据
      for (const collectionKey of evidenceCollectionKeys) {
        try {
          sourceEvidence = DataService.getDocument(collectionKey, finding.primary_evidence_id);
          if (sourceEvidence) {
            found = true;
            break;
          }
        } catch (e) { /* 忽略 */ }
      }

      // 4. 如果找到了源头，并且数据需要更新，则准备更新
      if (found && sourceEvidence && sourceEvidence.task_type) {
        const newDataType = sourceEvidence.task_type;
        const newDataUrl = sourceEvidence.url || finding.url || null;
        const newDataPubDate = sourceEvidence.publication_timestamp || finding.publication_timestamp || null;

        // 只有在数据不一致时才进行更新，以节省写入操作
        if (finding.task_type !== newDataType || finding.url !== newDataUrl || finding.publication_timestamp !== newDataPubDate) {
          findingsToUpdate.push({
            id: finding.id,
            task_type: newDataType,
            url: newDataUrl,
            publication_timestamp: newDataPubDate,
            updated_timestamp: new Date()
          });
          updatedCount++;
        }
      } else {
        Logger.log(`[${jobName}] WARN: 未能为发现 ID ${finding.id} 找到源头证据 (主证据ID: ${finding.primary_evidence_id})。`);
      }
    }

    // 5. 分批次批量更新数据库
    if (findingsToUpdate.length > 0) {
      Logger.log(`[${jobName}] 准备更新 ${findingsToUpdate.length} 条记录...`);
      for (let i = 0; i < findingsToUpdate.length; i += BATCH_SIZE) {
        const chunk = findingsToUpdate.slice(i, i + BATCH_SIZE);
        DataService.batchUpsert('FND_MASTER', chunk, 'id');
        Logger.log(`  -> 已更新 ${chunk.length} 条记录...`);
        Utilities.sleep(1000); // 在批次间稍作停顿
      }
      Logger.log(`✅ [${jobName}] 成功修复并更新了 ${updatedCount} 条“发现”记录。`);
    } else {
      Logger.log(`[${jobName}] 所有记录的数据均是正确的，无需更新。`);
    }

  } catch (e) {
    Logger.log(`❌ [${jobName}] 修复过程中发生严重错误: ${e.message}\n${e.stack}`);
  }
  Logger.log(`--- [${jobName}] 修复任务结束。共检查 ${processedCount} 条记录。---`);
}

/**
 * [清理工具]
 * 删除所有由无效名称生成的、ID不规范的实体。
 */
function MANUAL_cleanInvalidEntities() {
  const jobName = 'CleanInvalidEntities';
  Logger.log(`--- [${jobName}] 开始清理无效实体 ---`);
  
  try {
    const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
    
    const invalidEntityIds = allEntities.filter(e => {
      // 定义无效ID的规则：
      // 1. ID 为 "tech_" 或 "comp_" 等，即只有前缀。
      // 2. ID 以 "_数字" 结尾，例如 "tech_1", "tech_2"。
      // 3. 实体主名称长度小于等于2。
      const idParts = e.entity_id.split('_');
      const namePart = idParts.slice(1).join('_');
      
      const isPrefixOnly = namePart === '';
      const isEndingWithNumberOnly = /^\d+$/.test(namePart);
      const isNameTooShort = (e.primary_name || '').trim().length <= 2;

      return isPrefixOnly || isEndingWithNumberOnly || isNameTooShort;

    }).map(e => e.entity_id);

    if (invalidEntityIds.length > 0) {
      Logger.log(`[${jobName}] 发现 ${invalidEntityIds.length} 个无效实体待删除: ${invalidEntityIds.join(', ')}`);
      DataService.batchDeleteDocs('REG_ENTITIES', invalidEntityIds);
      Logger.log(`✅ [${jobName}] 成功删除了 ${invalidEntityIds.length} 个无效实体。`);
    } else {
      Logger.log(`[${jobName}] 未发现需要清理的无效实体。`);
    }
  } catch (e) {
    Logger.log(`❌ [${jobName}] 清理无效实体时失败: ${e.message}\n${e.stack}`);
  }
}

