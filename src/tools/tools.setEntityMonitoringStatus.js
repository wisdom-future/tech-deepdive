/**
 * @file tools/setEntityMonitoringStatus.js
 * @description 用于批量设置或更新 REG_ENTITIES 集合中实体监控状态的工具。
 */

/**
 * 设置 REG_ENTITIES 集合中一个或多个实体的监控状态。
 *
 * 该函数允许您根据实体ID、当前状态和实体类型来筛选要更新的实体。
 *
 * @param {string|string[]|null} targetEntityIds - 可选。要更新的实体ID或实体ID数组。
 *   - 如果为单个字符串，则更新该ID的实体。
 *   - 如果为数组，则更新数组中所有ID的实体。
 *   - 如果为 `null` 或 `[]`，则根据 `currentStatusFilter` 和 `entityTypeFilter` 筛选所有符合条件的实体。
 * @param {string|null} currentStatusFilter - 可选。只更新当前状态为该值的实体。
 *   - 如果为 `null`，则不考虑当前状态。
 *   - 示例: 'pending_review', 'normalized', 'active', 'inactive', 'merged_into'。
 * @param {string} newStatus - 必需。要将实体状态更新为的新值。
 *   - 示例: 'pending_review', 'normalized', 'active', 'inactive', 'merged_into'。
 * @param {string|null} entityTypeFilter - 可选。只更新类型为该值的实体。
 *   - 如果为 `null`，则不考虑实体类型。
 *   - 示例: 'Company', 'Technology', 'Person', 'Business_Event'。
 *
 * @returns {object} 包含处理结果的对象 { success: boolean, message: string, updatedCount: number }。
 */
function setEntityMonitoringStatus(
  targetEntityIds = null,
  currentStatusFilter = null,
  newStatus,
  entityTypeFilter = null
) {
  const jobName = 'SetEntityMonitoringStatus';
  Logger.log(`--- [${jobName}] 开始设置实体监控状态 ---`);
  Logger.log(`  目标实体ID: ${targetEntityIds ? (Array.isArray(targetEntityIds) ? targetEntityIds.join(', ') : targetEntityIds) : '所有符合筛选条件的实体'}`);
  Logger.log(`  当前状态过滤: ${currentStatusFilter || '无'}`);
  Logger.log(`  新状态: ${newStatus}`);
  Logger.log(`  实体类型过滤: ${entityTypeFilter || '无'}`);

  if (!newStatus || typeof newStatus !== 'string') {
    const msg = "错误：'newStatus' 参数是必需的，且必须是字符串。";
    Logger.log(`[${jobName}] ${msg}`);
    return { success: false, message: msg, updatedCount: 0 };
  }

  try {
    let filters = [];
    if (currentStatusFilter) {
      filters.push({ field: 'monitoring_status', operator: 'EQUAL', value: currentStatusFilter });
    }
    if (entityTypeFilter) {
      filters.push({ field: 'entity_type', operator: 'EQUAL', value: entityTypeFilter });
    }

    // 获取所有符合过滤条件的实体
    let entitiesToUpdate = DataService.getDataAsObjects('REG_ENTITIES', { filters: filters });

    // 如果指定了具体的实体ID，则进一步过滤
    if (targetEntityIds) {
      const idsArray = Array.isArray(targetEntityIds) ? targetEntityIds : [targetEntityIds];
      const targetIdSet = new Set(idsArray);
      entitiesToUpdate = entitiesToUpdate.filter(e => targetIdSet.has(e.entity_id));
    }

    if (!entitiesToUpdate || entitiesToUpdate.length === 0) {
      const msg = "没有找到符合条件的实体进行更新。";
      Logger.log(`[${jobName}] ${msg}`);
      return { success: true, message: msg, updatedCount: 0 };
    }

    Logger.log(`[${jobName}] 找到 ${entitiesToUpdate.length} 个实体待更新状态。`);

    const updates = entitiesToUpdate.map(entity => ({
      entity_id: entity.entity_id,
      monitoring_status: newStatus,
      updated_timestamp: new Date()
    }));

    // 执行批量更新
    const updatedCount = DataService.batchUpsert('REG_ENTITIES', updates, 'entity_id');

    const msg = `成功更新了 ${updatedCount} 个实体的监控状态为 '${newStatus}'。`;
    Logger.log(`[${jobName}] ${msg}`);
    return { success: true, message: msg, updatedCount: updatedCount };

  } catch (e) {
    const msg = `更新实体状态时发生错误: ${e.message}\n${e.stack}`;
    Logger.log(`[${jobName}] FATAL ERROR: ${msg}`);
    return { success: false, message: msg, updatedCount: 0 };
  }
}

function initializeCompanyEntitiesToActive() {
  setEntityMonitoringStatus(
    null,                  // targetEntityIds: null 表示不按ID过滤
    'pending_review',      // currentStatusFilter: 只处理 'pending_review' 状态的
    'active',              // newStatus: 设置为 'active'
    'Company'              // entityTypeFilter: 只处理 'Company' 类型的
  );
}


function moveTechEntitiesToNormalized() {
  setEntityMonitoringStatus(
    null,
    'pending_review',
    'normalized',
    'Technology'
  );
}

/**
 * @file tools/setEntityMonitoringStatus.js
 * @description 用于批量设置或更新 REG_ENTITIES 集合中实体监控状态的工具。
 */

// ... (setEntityMonitoringStatus 函数保持不变) ...

/**
 * 将所有公司类型的实体监控状态重置为 'pending_review'。
 *
 * 这个函数通常用于初始化、调试或在需要重新处理所有公司实体时使用。
 * 它会重置所有当前状态的公司实体。
 *
 */
function resetCompanyEntitiesToInitialState() {
  const jobName = 'ResetCompanyEntitiesToInitialState';
  Logger.log(`--- [${jobName}] 开始将所有公司类型实体重置为 'pending_review' 状态 ---`);

  try {
    const result = setEntityMonitoringStatus(
      null,           // targetEntityIds: null，表示不按特定ID过滤，处理所有公司实体
      null,           // currentStatusFilter: null，表示不按当前状态过滤，重置所有状态的公司实体
      'pending_review', // newStatus: 新状态设置为 'pending_review'
      'Company'       // entityTypeFilter: 只处理 'Company' 类型的实体
    );

    if (result.success) {
      Logger.log(`[${jobName}] 操作完成: ${result.message}`);
    } else {
      Logger.log(`[${jobName}] 操作失败: ${result.message}`);
    }
  } catch (e) {
    Logger.log(`[${jobName}] 发生严重错误: ${e.message}\n${e.stack}`);
  }

  Logger.log(`--- [${jobName}] 结束将所有公司类型实体重置为 'pending_review' 状态 ---`);
}


function resetAllEntitiesToPendingReview() {
  setEntityMonitoringStatus(
    null, // targetEntityIds: null
    null, // currentStatusFilter: null
    'pending_review', // newStatus
    null  // entityTypeFilter: null
  );
}

/**
 * 将一个或多个已丰富 (enriched) 的实体手动激活为活跃 (active) 监控状态。
 *
 * 只有状态为 'enriched' 的实体才会被激活。
 *
 * @param {string|string[]|null} targetEntityIds - 可选。要激活的实体ID或实体ID数组。
 *   - 如果为单个字符串，则激活该ID的实体。
 *   - 如果为数组，则激活数组中所有ID的实体。
 *   - 如果为 `null`，则激活所有当前状态为 'enriched' 的实体。
 * @param {string|null} entityTypeFilter - 可选。只激活指定类型的实体。
 *   - 如果为 `null`，则不考虑实体类型。
 *   - 示例: 'Company', 'Technology'。
 *
 * @returns {object} 包含处理结果的对象 { success: boolean, message: string, updatedCount: number }。
 */
function activateEnrichedEntities(targetEntityIds = null, entityTypeFilter = null) {
  const jobName = 'ActivateEnrichedEntities';
  Logger.log(`--- [${jobName}] 开始激活已丰富实体 ---`);
  Logger.log(`  目标实体ID: ${targetEntityIds ? (Array.isArray(targetEntityIds) ? targetEntityIds.join(', ') : targetEntityIds) : '所有符合条件的已丰富实体'}`);
  Logger.log(`  实体类型过滤: ${entityTypeFilter || '无'}`);

  try {
    const result = setEntityMonitoringStatus(
      targetEntityIds,
      'enriched', // currentStatusFilter: 只处理 'enriched' 状态的实体
      'active',   // newStatus: 设置为 'active'
      entityTypeFilter
    );

    if (result.success) {
      Logger.log(`[${jobName}] 操作完成: ${result.message}`);
    } else {
      Logger.log(`[${jobName}] 操作失败: ${result.message}`);
    }
    return result;
  } catch (e) {
    Logger.log(`[${jobName}] 发生严重错误: ${e.message}\n${e.stack}`);
    return { success: false, message: `激活实体时发生错误: ${e.message}`, updatedCount: 0 };
  }
}

/**
 * [工具函数] 列出所有技术和公司实体及其当前状态。
 * 运行此函数，可以在执行日志中看到一个清晰的列表，方便您挑选需要激活的实体。
 */
function listAllTechAndCompanies() {
  const jobName = 'ListAllEntities';
  Logger.log(`--- [${jobName}] 开始列出所有技术和公司实体 ---`);
  
  try {
    const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
    
    const technologies = allEntities.filter(e => e.entity_type === 'Technology');
    const companies = allEntities.filter(e => e.entity_type === 'Company');

    Logger.log("\n=============== 技术领域 (Technologies) ================");
    if (technologies.length > 0) {
      technologies.forEach(t => {
        Logger.log(`ID: ${t.entity_id} | 名称: ${t.primary_name} | 当前状态: ${t.monitoring_status}`);
      });
    } else {
      Logger.log("未找到任何技术实体。");
    }

    Logger.log("\n=============== 标杆企业 (Companies) ================");
    if (companies.length > 0) {
      companies.forEach(c => {
        Logger.log(`ID: ${c.entity_id} | 名称: ${c.primary_name} | 当前状态: ${c.monitoring_status}`);
      });
    } else {
      Logger.log("未找到任何公司实体。");
    }

    Logger.log(`\n--- [${jobName}] 列表完成。总计技术实体: ${technologies.length}, 公司实体: ${companies.length} ---`);
    
  } catch (e) {
    Logger.log(`❌ [${jobName}] 获取实体列表时失败: ${e.message}\n${e.stack}`);
  }
}

/**
 * [诊断工具 v2.0 - 无需参数]
 * 针对一个预设的公司实体，详细打印出用于计算其“创新活跃度分”的所有相关“发现”记录。
 * 您只需修改函数内部的 `COMPANY_ID_TO_DIAGNOSE` 变量，然后直接运行此函数即可。
 *
 * ✅ [v2.0 修正] 移除了函数参数，改为内部变量，以绕过Apps Script编辑器无法输入参数的问题。
 */
function DIAGNOSE_InnovationScore_Hardcoded() {
  const jobName = `DiagnoseInnovationScore_V2`;

  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  //  请在这里修改为您想诊断的公司ID
  const COMPANY_ID_TO_DIAGNOSE = 'comp_cognition';
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲

  Logger.log(`--- [${jobName}] 开始诊断实体 [${COMPANY_ID_TO_DIAGNOSE}] 的创新分计算过程 ---`);

  try {
    // 1. 获取所有与该公司相关的“发现”
    const relatedFindings = DataService.getDataAsObjects('FND_MASTER', {
      filters: [{ field: 'linked_entity_ids', operator: 'ARRAY_CONTAINS', value: COMPANY_ID_TO_DIAGNOSE }]
    });

    if (!relatedFindings || relatedFindings.length === 0) {
      Logger.log(`[${jobName}] ❌ 诊断失败：在 FND_MASTER 中未找到任何与 [${COMPANY_ID_TO_DIAGNOSE}] 相关的“发现”记录。`);
      return;
    }
    Logger.log(`[${jobName}] ✅ 找到 ${relatedFindings.length} 条与 [${COMPANY_ID_TO_DIAGNOSE}] 相关的“发现”记录。`);

    // 2. 筛选出“创新类”的发现
    let innovationScore = 0;
    let innovationFindingCount = 0;
    
    Logger.log(`\n--- [${jobName}] 开始筛选创新类发现 (类型为 ACADEMIC_PAPER, PATENT, OPENSOURCE) ---`);
    
    relatedFindings.forEach(f => {
      const taskType = AnalysisService._getTaskTypeFromFinding(f);
      
      Logger.log(`  - 检查发现 ID: ${f.id} | 推断出的任务类型: ${taskType}`);
      
      if (['ACADEMIC_PAPER', 'PATENT', 'OPENSOURCE'].includes(taskType)) {
        innovationFindingCount++;
        const score = f.signal_strength_score || 5;
        innovationScore += score;
        Logger.log(`    ✅ 匹配成功! 此发现被计入创新分。增加分数: ${score}`);
      } else {
        Logger.log(`    ❌ 未匹配。此发现不计入创新分。`);
      }
    });

    Logger.log(`\n--- [${jobName}] 诊断结果 ---`);
    Logger.log(`  - 找到的创新类发现总数: ${innovationFindingCount}`);
    Logger.log(`  - 计算出的原始创新活跃度分 (累加值): ${innovationScore}`);
    
    if (innovationFindingCount === 0) {
      Logger.log(`\n[${jobName}] 结论：由于没有找到任何与 [${COMPANY_ID_TO_DIAGNOSE}] 关联的、类型为论文/专利/开源的“发现”，因此其创新活跃度分计算结果为 0。这验证了之前的诊断。`);
    } else {
      Logger.log(`\n[${jobName}] 结论：找到了创新类发现，其累加分数为 ${innovationScore}。`);
    }

  } catch (e) {
    Logger.log(`❌ [${jobName}] 诊断过程中发生错误: ${e.message}\n${e.stack}`);
  }
}


