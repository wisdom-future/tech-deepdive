// 文件名: backend/migration.gs @20250702

/**
 * @file 一次性数据迁移脚本
 * 版本 2.3 - 增加对源数据中重复ID的处理逻辑，确保批量写入成功。
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
 * ✅ 核心改造：采用覆盖写入模式
 */
function _migrateSingleSheet(sheetId, sheetName, collectionName, idField) {
  Logger.log(`--- 开始迁移: ${sheetName} -> ${collectionName} (模式: 覆盖写入) ---`);
  
  try {
    const firestore = FirestoreService._getFirestoreInstance();
    const allObjects = DataService.getDataAsObjects(sheetId, sheetName);
    if (!allObjects || allObjects.length === 0) {
      Logger.log(`  - 表 '${sheetName}' 为空，跳过迁移。`);
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
        
        // **核心修改：**
        // 不再使用 currentDocument 条件，直接使用 update。
        // 在 Firestore 中，一个不带前提条件的 update/patch 操作如果指定了完整路径，
        // 效果就是 "Upsert"：如果文档存在则更新，不存在则创建。
        // 但 FirestoreApp 库的 batch() 不支持直接的 upsert，所以我们使用 update。
        // 在执行前，我们应该先清空集合。
        return {
          update: {
            name: path,
            fields: firestoreFields.fields
          }
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

/**
 * [TEST FUNCTION]
 * 版本 2.0 - 修复 Browser.msgBox 错误
 */
function testFirestoreConnection() {
  Logger.log("========= [开始] Firestore 连接测试 =========");
  
  const TEST_COLLECTION_NAME = "test_connection";
  const TEST_DOCUMENT_ID = "doc_" + new Date().getTime();

  try {
    Logger.log("步骤 1/4: 正在获取 Firestore 实例...");
    const firestore = FirestoreService._getFirestoreInstance();
    Logger.log("✅ 成功获取 Firestore 实例。");

    const testData = {
      message: "Hello, Firestore! Connection successful.",
      timestamp: new Date(),
      testId: TEST_DOCUMENT_ID
    };
    Logger.log("步骤 2/4: 准备写入测试数据: " + JSON.stringify(testData));

    Logger.log("步骤 3/4: 正在向集合 '" + TEST_COLLECTION_NAME + "' 写入一个测试文档...");
    FirestoreService.createDocument(TEST_COLLECTION_NAME, testData, TEST_DOCUMENT_ID);
    Logger.log("✅ 成功写入测试文档。文档 ID: " + TEST_DOCUMENT_ID);

    Logger.log("步骤 4/4: 正在读取刚刚创建的文档...");
    const readData = FirestoreService.getDocument(TEST_COLLECTION_NAME + "/" + TEST_DOCUMENT_ID);
    
    if (readData && readData.testId === TEST_DOCUMENT_ID) {
      Logger.log("✅ 成功读取并验证了文档内容。");
      Logger.log("读取到的数据: " + JSON.stringify(readData));
      Logger.log("🎉🎉🎉 [成功] Firestore 连接和基本操作验证通过！🎉🎉🎉");
      // ✅ 修正：使用 Logger.log 代替 Browser.msgBox
      Logger.log("测试结果：成功！");
    } else {
      throw new Error("读取到的数据与写入的数据不匹配，或未能读取到数据。");
    }

  } catch (e) {
    Logger.log(`!!!!!!!!!! [严重错误] Firestore 测试失败: ${e.message} !!!!!!!!!!!`);
    Logger.log("错误详情: " + e.stack);
    // ✅ 修正：使用 Logger.log 代替 Browser.msgBox
    Logger.log("测试结果：失败！");
  }
}

