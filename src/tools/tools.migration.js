/**
 * @file tools.migration.js
 * @description [数据迁移] 存放将旧版数据模型迁移到新版模型的、一次性的脚本。
 * [v7.0] 最终修正版：将实体迁移和用户/角色迁移彻底分离，确保数据模型正确。
 */

//==================================================================
//  迁移任务 1: 迁移所有“非用户”核心实体
//==================================================================

/**
 * [可执行] 将旧的、分散的实体注册表（技术、公司、会议等）迁移到统一的 'REG_ENTITIES' 集合。
 * !! 此脚本不再处理用户数据 !!
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
function runMigrateCoreEntities() {
  const jobName = 'MigrateCoreEntities';
  Logger.log(`--- [${jobName}] 开始执行核心实体迁移任务 ---`);
  
  const TARGET_DATABASE_ID = 'deepdive-engine';

  const migrationMap = {
    'technology_registry': { entityType: 'Technology', idField: 'tech_id', nameField: 'tech_name' },
    'competitor_registry': { entityType: 'Company', idField: 'competitor_id', nameField: 'company_name' },
    'conference_registry': { entityType: 'Business_Event', idField: 'conference_id', nameField: 'conference_name' },
    'entities': { entityType: null, idField: 'entity_id', nameField: 'primary_name' }
  };

  const allNewEntities = [];
  const processedIds = new Set();
  
  for (const oldCollectionName in migrationMap) {
    const config = migrationMap[oldCollectionName];
    try {
      const oldItems = FirestoreService.queryNativeMode(oldCollectionName, TARGET_DATABASE_ID, {});
      if (!oldItems || oldItems.length === 0) continue;
      
      oldItems.forEach(item => {
        const primaryName = item[config.nameField];
        const entityType = config.entityType || item.entity_type; 
        if (!primaryName || !entityType) return;
        
        const idPrefix = entityType.slice(0, 4).toLowerCase() + '_';
        const normalizedNamePart = Helpers.normalizeForId(primaryName);
        let newEntityId = `${idPrefix}${normalizedNamePart}`;

        if (processedIds.has(newEntityId)) {
            const oldIdSuffix = `_${Helpers.generateUuid().substring(0, 4)}`;
            newEntityId = `${newEntityId}${oldIdSuffix}`;
        }
        processedIds.add(newEntityId);

        const newEntity = {
          entity_id: newEntityId,
          primary_name: primaryName,
          entity_type: entityType,
          aliases: item.aliases || (item.stock_symbol ? [item.stock_symbol] : []),
          description: item.description || item.notes || '',
          monitoring_status: item.monitoring_status || 'inactive',
          stock_symbol: item.stock_symbol || null,
          created_timestamp: item.created_timestamp || item.created_date ? new Date(item.created_timestamp || item.created_date) : new Date(),
          updated_timestamp: new Date(),
          legacy_id: item[config.idField] || item.id || null
        };
        allNewEntities.push(newEntity);
      });
      Logger.log(`[${jobName}] 从 ${oldCollectionName} 转换了 ${oldItems.length} 条记录。`);
    } catch (e) {
      Logger.log(`[${jobName}] ERROR: 处理旧集合 ${oldCollectionName} 时失败: ${e.message}`);
    }
  }

  if (allNewEntities.length > 0) {
    DataService.batchUpsert('REG_ENTITIES', allNewEntities, 'entity_id');
    Logger.log(`[${jobName}] 成功将 ${allNewEntities.length} 个核心实体写入 'REG_ENTITIES'。`);
  }
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}


//==================================================================
//  迁移任务 2: 迁移用户和角色数据
//==================================================================

/**
 * [可执行] 将旧的 'user_accounts' 和 'roles_registry' 数据迁移到新的对应集合中。
 * 同时，会为每个用户在 'REG_ENTITIES' 中创建一个 'Person' 类型的实体。
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
function runMigrateUsersAndRoles() {
  const jobName = 'MigrateUsersAndRoles';
  Logger.log(`--- [${jobName}] 开始迁移用户和角色数据 ---`);

  const TARGET_DATABASE_ID = 'deepdive-engine';

  // --- Step 1: 迁移角色 (Roles) ---
  try {
    const oldRoles = FirestoreService.queryNativeMode('roles_registry', TARGET_DATABASE_ID, {});
    if (oldRoles && oldRoles.length > 0) {
      DataService.batchUpsert('REG_ROLES', oldRoles, 'role_id');
      Logger.log(`[${jobName}] 成功迁移 ${oldRoles.length} 个角色到 'REG_ROLES'。`);
    } else {
      Logger.log(`[${jobName}] 未找到旧的角色数据，将使用seeding脚本初始化。`);
    }
  } catch (e) {
    Logger.log(`[${jobName}] ERROR: 迁移角色数据时失败: ${e.message}`);
  }

  // --- Step 2: 迁移用户 (Users) ---
  try {
    const oldUsers = FirestoreService.queryNativeMode('user_accounts', TARGET_DATABASE_ID, {});
    if (oldUsers && oldUsers.length > 0) {
      const newUserAccounts = [];
      const newUserEntities = [];

      oldUsers.forEach(user => {
        const userName = user.display_name || user.user_email.split('@')[0];
        const personEntityId = `pers_${Helpers.normalizeForId(userName)}`;

        // 构造新的用户账户记录
        newUserAccounts.push({
          user_email: user.user_email,
          display_name: userName,
          role_id: user.role_id,
          status: user.status || 'active',
          entity_id: personEntityId, // 关联到Person实体
          created_timestamp: user.created_timestamp ? new Date(user.created_timestamp) : new Date(),
          updated_timestamp: new Date()
        });

        // 为该用户创建一个Person实体
        newUserEntities.push({
          entity_id: personEntityId,
          primary_name: userName,
          entity_type: 'Person',
          aliases: [user.user_email],
          description: `User account: ${user.user_email}`,
          monitoring_status: 'inactive', // 人物默认不主动采集
          created_timestamp: user.created_timestamp ? new Date(user.created_timestamp) : new Date(),
          updated_timestamp: new Date(),
          legacy_id: user.user_email
        });
      });

      // 批量写入
      DataService.batchUpsert('REG_USERS', newUserAccounts, 'user_email');
      Logger.log(`[${jobName}] 成功迁移 ${newUserAccounts.length} 个用户账户到 'REG_USERS'。`);
      
      DataService.batchUpsert('REG_ENTITIES', newUserEntities, 'entity_id');
      Logger.log(`[${jobName}] 成功为 ${newUserEntities.length} 个用户在 'REG_ENTITIES' 中创建了Person实体。`);

    } else {
      Logger.log(`[${jobName}] 未找到旧的用户数据。`);
    }
  } catch (e) {
    Logger.log(`[${jobName}] ERROR: 迁移用户数据时失败: ${e.message}`);
  }
  
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}

/**
 * @description 这是一个临时函数，用于手动清除DataConnector的内部缓存。
 * 运行一次后即可删除。
 */
function MANUALLY_CLEAR_CACHE() {
  DataConnector.clearCache();
  Logger.log("✅ DataConnector 内部缓存已成功清除！");
}

/**
 * @file TranslateEntities.gs
 * @description [最终修正版v4] 独立的实体翻译工具。
 */

// ================== 配置项 ==================
const BATCH_SIZE_FOR_TRANSLATION = 10;
const SCRIPT_PROPERTY_KEY = 'TRANSLATION_PROCESSED_IDS';

/**
 * [手动运行] 主函数
 */
async function runEntityTranslation() {
  const jobName = 'EntityTranslator';
  Logger.log(`[${jobName}] --- 开始翻译技术实体 ---`);

  try {
    const allTechs = DataService.getDataAsObjects('REG_ENTITIES', {
      filters: [{ field: 'entity_type', operator: 'EQUAL', value: 'Technology' }],
    });

    const processedIdsStr = PropertiesService.getScriptProperties().getProperty(SCRIPT_PROPERTY_KEY);
    const processedIds = new Set(processedIdsStr ? JSON.parse(processedIdsStr) : []);
    
    const techsToProcess = allTechs.filter(tech => 
       !processedIds.has(tech.entity_id) &&
       (!tech.tech_keywords || String(tech.tech_keywords).trim() === '') &&
       containsChinese(tech.primary_name)
    );

    if (techsToProcess.length === 0) {
      Logger.log(`[${jobName}] 所有符合条件的中文技术实体均已翻译。任务完成！`);
      PropertiesService.getScriptProperties().deleteProperty(SCRIPT_PROPERTY_KEY);
      return;
    }
    
    const currentBatch = techsToProcess.slice(0, BATCH_SIZE_FOR_TRANSLATION);
    Logger.log(`[${jobName}] 发现 ${techsToProcess.length} 个待翻译实体，本次将处理 ${currentBatch.length} 个。`);

    // [关键] 只提取中文名列表发给AI
    const chineseNamesForAI = currentBatch.map(tech => tech.primary_name);

    const translationPrompt = `
      You are a precise data processing bot. Your only task is to translate a list of Chinese technical terms into English keywords.
      You MUST return a single, valid JSON object.
      The object MUST have a top-level key named "translations".
      The value of "translations" MUST be an array of strings. Each string contains the comma-separated English keywords for the corresponding input term.
      The order of the translated strings in the output array MUST EXACTLY MATCH the order of the Chinese terms in the input array.

      Input Chinese terms (JSON array of strings):
      ${JSON.stringify(chineseNamesForAI)}

      Required output format example:
      {
        "translations": [
          "Quantum Chip Technology, Quantum Computing, Qubit",
          "5G Millimeter Wave, 5G mmWave",
          "..."
        ]
      }
    `;
    
    const aiResult = await DataConnector.getBatchCompletions(translationPrompt, {});
    
    Logger.log(`[诊断日志] AI原始返回: ${JSON.stringify(aiResult)}`);

    const updatesToBatch = [];
    const idsProcessedInThisRun = [];

    const translationResults = aiResult.translations;

    if (Array.isArray(translationResults) && translationResults.length === currentBatch.length) {
      for (let i = 0; i < currentBatch.length; i++) {
        // [核心修正] 从 currentBatch 中获取正确的原始实体对象和ID
        const originalTech = currentBatch[i];
        const keywords = translationResults[i];

        if (originalTech && originalTech.entity_id && typeof keywords === 'string' && keywords.trim() !== '') {
          updatesToBatch.push({
            entity_id: originalTech.entity_id,
            tech_keywords: keywords,
            updated_timestamp: new Date()
          });
          idsProcessedInThisRun.push(originalTech.entity_id);
          Logger.log(`[${jobName}] 准备更新实体 ID '${originalTech.entity_id}' -> Keywords: '${keywords}'`);
        } else {
            Logger.log(`[${jobName}] WARN: 匹配失败或关键词为空。索引: ${i}, 实体ID: ${originalTech?.entity_id}, 关键词: ${keywords}`);
        }
      }
    } else {
        Logger.log(`[${jobName}] WARN: AI返回的数据格式不正确，或返回结果数量 (${translationResults?.length}) 与发送数量 (${currentBatch.length}) 不匹配。`);
    }

    if (updatesToBatch.length > 0) {
      DataService.batchUpsert('REG_ENTITIES', updatesToBatch, 'entity_id');
      Logger.log(`[${jobName}] 成功向数据库提交了 ${updatesToBatch.length} 个实体的更新。`);
    }

    if (idsProcessedInThisRun.length > 0) {
      const uniqueIds = [...new Set(idsProcessedInThisRun)]; // 确保没有重复ID
      uniqueIds.forEach(id => processedIds.add(id));
      PropertiesService.getScriptProperties().setProperty(SCRIPT_PROPERTY_KEY, JSON.stringify(Array.from(processedIds)));
      Logger.log(`[${jobName}] 本批次处理完成。已更新进度。剩余待处理：${techsToProcess.length - uniqueIds.length}。请再次运行此脚本。`);
    } else {
       Logger.log(`[${jobName}] 本批次未能成功翻译或匹配任何实体，进度未更新。请检查上面的[诊断日志]。`);
    }

  } catch (e) {
    Logger.log(`[${jobName}] 发生严重错误: ${e.message}\n${e.stack}`);
  }
}

function containsChinese(str) {
  if (!str) return false;
  return /[\u4e00-\u9fa5]/.test(str);
}

function resetTranslationProgress() {
  PropertiesService.getScriptProperties().deleteProperty(SCRIPT_PROPERTY_KEY);
  Logger.log('翻译进度已重置。下次运行将从头开始。');
}

function DeleteOldPapers() {
  let collectionName = "raw_academic_papers";
  deleteFirestoreCollection(collectionName);
  Logger.log('翻译进度已重置。下次运行将从头开始。');
}

/**
 * @file tools/deleteFirestoreCollection.js
 * @description 用于递归删除Firestore集合中所有文档的工具脚本。
 *              删除集合的常用方法是删除其所有文档。
 */

/**
 * 递归删除指定Firestore集合中的所有文档。
 * 由于Apps Script有执行时间限制，该函数会分批删除，可能需要多次运行。
 *
 * @param {string} collectionName - 要删除的集合的名称 (例如: 'raw_academic_papers')。
 * @param {string} databaseId -  Firestore 数据库的 ID (通常是 'deepdive-engine')。
 * @param {number} batchSize - 每次删除操作的文档数量 (Firestore 批量写入限制为 500)。
 * @returns {object} 包含操作结果的对象。
 */
function deleteFirestoreCollection(collectionName, databaseId = 'deepdive-engine', batchSize = 400) {
  const jobName = `DeleteCollection(${collectionName})`;
  Logger.log(`--- [${jobName}] 开始删除集合中的文档 ---`);
  Logger.log(`[${jobName}] 目标集合: ${collectionName}, 数据库: ${databaseId}, 批次大小: ${batchSize}`);

  if (!collectionName) {
    const msg = "错误：集合名称不能为空。";
    Logger.log(`[${jobName}] ${msg}`);
    return { success: false, message: msg };
  }

  try {
    // 确保 projectId 已被设置 (通过 FirestoreService._getAuthToken() 初始化)
    if (!FirestoreService.projectId) {
      FirestoreService._getAuthToken();
    }
    const projectId = FirestoreService.projectId;
    if (!projectId) {
      const msg = "Firestore 项目ID未配置。请检查脚本属性。";
      Logger.log(`[${jobName}] ${msg}`);
      return { success: false, message: msg };
    }

    let documentsDeleted = 0;
    let hasMore = true;

    // 由于 Apps Script 的同步执行和时间限制，我们一次只查询和删除一个批次。
    // Firestore 的 listDocuments API 没有直接的 limit，但我们可以通过查询实现。
    // 但是，Firestore REST API 的 listDocuments 接口本身没有直接的 limit 参数，
    // 只能通过 runQuery 接口来模拟 limit。
    // 最简单的做法是直接调用 listDocuments，然后手动 slice。

    // 更可靠但可能更耗时的做法是使用 Admin SDK（Apps Script 不支持）
    // 或者通过循环调用 queryNativeMode 并加上 limit 来实现。

    // 考虑到 Apps Script 环境的限制，我们将使用 queryNativeMode 来获取批次文档ID
    // 注意：queryNativeMode 返回的是文档对象，我们需要它们的 ID 来构建删除路径

    const documentsToDelete = DataService.getDataAsObjects(collectionName, { limit: batchSize });
    
    if (!documentsToDelete || documentsToDelete.length === 0) {
        Logger.log(`[${jobName}] 集合 '${collectionName}' 中没有更多文档需要删除。任务完成。`);
        return { success: true, message: `集合 '${collectionName}' 已清空或没有文档。`, deletedCount: 0 };
    }

    Logger.log(`[${jobName}] 找到 ${documentsToDelete.length} 个文档待删除。`);

    const writes = documentsToDelete.map(doc => {
        // doc.id 字段是由 _fsUnwrapDocument 添加的
        const docId = doc.id;
        if (!docId) {
            Logger.log(`[${jobName}] WARN: 无法获取文档的ID，跳过: ${JSON.stringify(doc)}`);
            return null;
        }
        return {
            delete: `projects/${projectId}/databases/${databaseId}/documents/${collectionName}/${docId}`
        };
    }).filter(Boolean);

    if (writes.length > 0) {
        // 批量删除
        FirestoreService.batchWrite(writes, databaseId);
        documentsDeleted = writes.length;
        Logger.log(`[${jobName}] 成功删除了 ${documentsDeleted} 个文档。`);
    } else {
        Logger.log(`[${jobName}] 没有文档被删除（可能因为ID无效）。`);
    }

    // 提示用户可能需要再次运行
    if (documentsDeleted === batchSize) {
        Logger.log(`[${jobName}] 提示：可能还有更多文档。请再次运行此脚本以继续删除。`);
        return { success: true, message: `成功删除了 ${documentsDeleted} 个文档。可能需要再次运行。`, deletedCount: documentsDeleted, hasMore: true };
    } else {
        Logger.log(`[${jobName}] 集合 '${collectionName}' 已清空。`);
        return { success: true, message: `集合 '${collectionName}' 已清空。`, deletedCount: documentsDeleted, hasMore: false };
    }

  } catch (e) {
    const msg = `删除集合 '${collectionName}' 时发生错误: ${e.message}\n${e.stack}`;
    Logger.log(`[${jobName}] FATAL ERROR: ${msg}`);
    return { success: false, message: msg };
  } finally {
    Logger.log(`--- [${jobName}] 结束删除集合中的文档 ---`);
  }
}

/**
 * [最终清理脚本 v2.0]
 * 彻底删除所有由系统自动化流程生成的“衍生数据”。
 *
 * ✅ [v2.0 修正] 修正了 `collectionsToDelete` 数组中的所有逻辑键名，使其与 Config.gs 中的定义完全匹配。
 *
 * !!! 这是一个高危操作，运行前请务必确认您希望从一个干净的状态重新开始 !!!
 * 此操作会保留所有核心配置集合 (REG_*)。
 *
 * @param {boolean} confirm - 必须明确传入 true 才能执行，防止意外运行。
 */
function MANUAL_cleanAllDerivedData(confirm = false) {
  const jobName = 'CleanAllDerivedData_V2';

  if (confirm !== true) {
    const message = `安全锁已启动！要执行此高危删除操作，您必须在运行函数时传入参数 'true'。`;
    Logger.log(message);
    return;
  }

  Logger.log(`--- [${jobName}] 开始执行衍生数据彻底清理任务 ---`);
  Logger.log('!!! 警告：此操作将删除多个集合中的所有文档 !!!');
  Utilities.sleep(3000);

  // ✅ [核心修正] 使用与 Config.gs 完全一致的大写键名
  const collectionsToDelete = [
    // 1. 过程数据
    'QUEUE_TASKS',
    
    // 2. 所有分析结果
    'ANL_DAILY_SNAPSHOTS',
    'KG_EDGES',
    'FND_MASTER',
    
    // 3. 所有证据数据
    'EVD_PAPERS',
    'EVD_NEWS',
    'EVD_OPENSOURCE',
    'EVD_JOBS',
    'EVD_DYNAMICS',
    'EVD_PATENTS',
    'EVD_REPORTS',
    'EVD_FILINGS',
    'EVD_VIDEOS',
    'EVD_POLICIES',
    'EVD_COMPETITOR',
    'OLDA',
    'OLDB',
    'OLDC',
    'OLDD',
    'OLDE',
    'OLDF'
    // 注意：已移除所有 raw_* 集合，因为它们已被废弃
  ];

  let totalDeletedCount = 0;

  for (const collectionKey of collectionsToDelete) {
    try {
      const collectionName = CONFIG.FIRESTORE_COLLECTIONS[collectionKey];
      if (!collectionName) {
        Logger.log(`[${jobName}] WARN: 在 Config.gs 中未找到键名 [${collectionKey}] 对应的集合，已跳过。`);
        continue;
      }
      
      Logger.log(`\n--- 正在清理集合: ${collectionName} (逻辑键: ${collectionKey}) ---`);
      
      const BATCH_SIZE = 200;
      let hasMore = true;
      let deletedInCollection = 0;

      while(hasMore) {
        // 使用正确的逻辑键名调用 DataService
        const docs = DataService.getDataAsObjects(collectionKey, { limit: BATCH_SIZE });
        
        if (docs && docs.length > 0) {
          const docIds = docs.map(d => d.id);
          const deletedCount = DataService.batchDeleteDocs(collectionKey, docIds);
          deletedInCollection += deletedCount;
          Logger.log(`  -> 已删除 ${deletedCount} 个文档...`);
          if (docs.length < BATCH_SIZE) {
            hasMore = false;
          }
        } else {
          hasMore = false;
        }
      }
      
      if (deletedInCollection > 0) {
        Logger.log(`✅ 集合 [${collectionName}] 清理完成，共删除 ${deletedInCollection} 个文档。`);
      } else {
        Logger.log(`ℹ️ 集合 [${collectionName}] 本身为空，无需清理。`);
      }
      totalDeletedCount += deletedInCollection;

    } catch (e) {
      Logger.log(`❌ 清理集合 [${collectionKey}] 时发生错误: ${e.message}`);
    }
  }
  
  Logger.log(`\n--- [${jobName}] 所有衍生数据清理任务执行完毕 ---`);
  Logger.log(`🎉 总计删除了 ${totalDeletedCount} 个文档。您的核心配置数据已被保留。`);
}



