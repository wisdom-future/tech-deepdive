// 文件名: backend/migration.gs @20250702

/**
 * @file 一次性数据迁移脚本
 * 版本 2.5 - 增加迁移前清空集合的功能，确保幂等性。
 */

function runFullMigrationToFirestore() {
  Logger.log("========= [开始] 全量数据迁移至 Firestore =========");

  const tablesToMigrate = [
    // CONFIG_DB
    { dbId: CONFIG.DATABASE_IDS.CONFIG_DB, sheetName: CONFIG.SHEET_NAMES.TECH_REGISTRY, collectionName: 'technology_registry', idField: 'tech_id' },
    { dbId: CONFIG.DATABASE_IDS.CONFIG_DB, sheetName: CONFIG.SHEET_NAMES.COMPETITOR_REGISTRY, collectionName: 'competitor_registry', idField: 'competitor_id' },
    { dbId: CONFIG.DATABASE_IDS.CONFIG_DB, sheetName: CONFIG.SHEET_NAMES.CONFERENCE_REGISTRY, collectionName: 'conference_registry', idField: 'conference_id' },
    { dbId: CONFIG.DATABASE_IDS.CONFIG_DB, sheetName: CONFIG.SHEET_NAMES.REPORT_RECIPIENTS, collectionName: 'report_recipients', idField: 'recipient_id' },
    { dbId: CONFIG.DATABASE_IDS.CONFIG_DB, sheetName: CONFIG.SHEET_NAMES.SCHEDULED_REPORTS_CONFIG, collectionName: 'scheduled_reports_config', idField: 'job_id' },
    
    // RAWDATA_DB
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS, collectionName: 'raw_academic_papers', idField: 'raw_id' },
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_TECH_NEWS, collectionName: 'raw_tech_news', idField: 'raw_id' },
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA, collectionName: 'raw_opensource_data', idField: 'raw_id' },
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_PATENT_DATA, collectionName: 'raw_patent_data', idField: 'raw_id' },
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS, collectionName: 'raw_industry_dynamics', idField: 'raw_id' },
    { dbId: CONFIG.DATABASE_IDS.RAWDATA_DB, sheetName: CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE, collectionName: 'raw_competitor_intelligence', idField: 'raw_id' },
    
    // INTELLIGENCE_DB
    { dbId: CONFIG.DATABASE_IDS.INTELLIGENCE_DB, sheetName: CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER, collectionName: 'tech_insights_master', idField: 'intelligence_id' },
    { dbId: CONFIG.DATABASE_IDS.INTELLIGENCE_DB, sheetName: CONFIG.SHEET_NAMES.EVIDENCE_VALIDATION, collectionName: 'evidence_validation_matrix', idField: 'validation_id' },

    // OPERATIONS_DB
    { dbId: CONFIG.DATABASE_IDS.OPERATIONS_DB, sheetName: CONFIG.SHEET_NAMES.WORKFLOW_LOG, collectionName: 'workflow_execution_log', idField: 'execution_id' },
    { dbId: CONFIG.DATABASE_IDS.OPERATIONS_DB, sheetName: CONFIG.SHEET_NAMES.REPORTS_HISTORY, collectionName: 'reports_history', idField: 'report_id' },
    { dbId: CONFIG.DATABASE_IDS.OPERATIONS_DB, sheetName: CONFIG.SHEET_NAMES.DATA_QUALITY_REPORTS, collectionName: 'data_quality_reports', idField: 'report_id' }
  ];

  try {
    for (const table of tablesToMigrate) {
      if (table.sheetName) {
        _migrateSingleSheet(table.dbId, table.sheetName, table.collectionName, table.idField);
      }
    }
    Logger.log("========= [成功] 所有已定义的数据表迁移任务已执行！ =========");
  } catch (e) {
    Logger.log(`!!!!!!!!!! [严重错误] 迁移过程中发生错误: ${e.message} !!!!!!!!!!!`);
    Logger.log(e.stack);
  }
}

/**
 * ✅ 核心改造：在写入前清空集合
 */
function _migrateSingleSheet(sheetId, sheetName, collectionName, idField) {
  Logger.log(`--- 开始迁移: ${sheetName} -> ${collectionName} (模式: 清空后写入) ---`);
  
  try {
    // ✅ 新增：在写入数据之前，先清空目标集合
    FirestoreService.deleteCollection(collectionName);
    Utilities.sleep(2000); // 暂停2秒，确保删除操作有足够时间生效

    const firestore = FirestoreService._getFirestoreInstance();
    const allObjects = DataService.getDataAsObjects(sheetId, sheetName);
    if (!allObjects || allObjects.length === 0) {
      Logger.log(`  - 表 '${sheetName}' 为空，跳过写入。`);
      return;
    }

    Logger.log(`  - 从 '${sheetName}' 读取到 ${allObjects.length} 条记录。`);
    
    const uniqueObjects = [];
    const seenIds = new Set();
    for (const obj of allObjects) {
      const id = obj[idField];
      if (id && !seenIds.has(id)) {
        uniqueObjects.push(obj);
        seenIds.add(id);
      } else if (!id) {
        uniqueObjects.push(obj);
      }
    }

    if (allObjects.length !== uniqueObjects.length) {
      Logger.log(`  - 警告: 发现并移除了 ${allObjects.length - uniqueObjects.length} 条重复ID的记录。`);
    }

    const batchSize = 400;
    let successCount = 0;
    for (let i = 0; i < uniqueObjects.length; i += batchSize) {
      const batchObjects = uniqueObjects.slice(i, i + batchSize);
      
      const writes = batchObjects.map(obj => {
        const docId = obj[idField] || firestore.autoId();
        const path = `projects/${firestore.projectId}/databases/(default)/documents/${collectionName}/${docId}`;
        const firestoreFields = firestore.create(obj);
        
        return {
          update: { // ✅ 使用 update 操作，因为集合已经被清空，等同于创建
            name: path,
            fields: firestoreFields.fields
          },
          // 这里不需要 currentDocument: { exists: false }，因为我们已经清空了集合
        };
      });
      
      FirestoreService.executeBatchWrites(writes);

      successCount += batchObjects.length;
      Logger.log(`  - 已成功提交 ${successCount} / ${uniqueObjects.length} 条记录...`);
      Utilities.sleep(1000);
    }

    Logger.log(`--- ✅ 迁移完成: ${sheetName} -> ${collectionName} ---`);

  } catch (e) {
    Logger.log(`  --- ❌ 迁移失败: ${sheetName} -> ${collectionName}. 原因: ${e.message} ---`);
    Logger.log(e.stack);
  }
}


