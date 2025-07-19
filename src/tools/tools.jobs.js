/**
 * @file tools.jobs.js
 * @description 存放所有将被Google Apps Script定时器直接调度的顶层函数。
 * 这是“后台异步执行泳道”的唯一入口。
 *
 * 任务调度分类：
 * - 高频任务 (Hourly): 数据采集
 * - 中频任务 (Frequent): 任务队列处理
 * - 低频任务 (Daily/Infrequent): 实体智能管理、分析工作流、维护
 */

//==================================================================
// 1. 高频任务：数据采集 (Hourly)
//==================================================================

/**
 * [高频任务] 数据采集任务。
 * 建议在Google Apps Script的触发器中设置为“每小时”运行。
 */
async function runHourlyCollectionJob() {
  const jobName = 'HourlyCollectionJob';
  Logger.log(`--- [${jobName}] Starting Job ---`);
  
  try {
    Logger.log(`[${jobName}] Running Technology Source Driver...`);
    // TechnologySourceDriver 来自 layer03.SourceTechService.js
    await TechnologySourceDriver.run();
  } catch(e) {
    Logger.log(`[${jobName}] FATAL ERROR in TechnologySourceDriver: ${e.stack}`);
  }
  
  try {
    Logger.log(`[${jobName}] Running Company Source Driver...`);
    // CompanySourceDriver 来自 layer03.SourceCompanyService.js
    await CompanySourceDriver.run();
  } catch(e) {
    Logger.log(`[${jobName}] FATAL ERROR in CompanySourceDriver: ${e.stack}`);
  }
  
  Logger.log(`--- [${jobName}] Finished Job ---`);
}

//==================================================================
// 2. 中频任务：数据处理 (Frequent)
//==================================================================

/**
 * [中频任务] 数据处理任务。
 * 建议设置为“每15分钟”或“每30分钟”运行，以尽快处理采集到的任务。
 */
async function runFrequentProcessingJob() { // 更改为 async，因为 ProcessingService.processTaskQueue() 是 async
  const jobName = 'FrequentProcessingJob';
  Logger.log(`--- [${jobName}] Starting Job ---`);
  
  try {
    // ProcessingService 来自 layer03.DataProcessService.js
    await ProcessingService.processTaskQueue(); // 添加 await
  } catch(e) {
    Logger.log(`[${jobName}] FATAL ERROR in ProcessingService: ${e.stack}`);
  }
  
  Logger.log(`--- [${jobName}] Finished Job ---`);
}

//==================================================================
// 3. 低频任务：每日分析与维护 (Daily/Infrequent)
//==================================================================

/**
 * [低频任务] 每日后台分析与维护总调度。
 * 建议设置为“每日凌晨”（例如 2:00 AM）运行。
 * 这个函数将协调所有每日或不频繁运行的后台任务。
 */
async function runDailyMaintenanceAndAnalysisJob() {
  const jobName = 'DailyMaintenanceAndAnalysisJob';
  Logger.log(`--- [${jobName}] Starting Job ---`);

  // --- A. 智能实体标准化与合并 ---
  try {
    Logger.log(`[${jobName}] Running Entity Normalization Job...`);
    const { processed, errors } = await AnalysisService._intelligentEntityNormalization();
    Logger.log(`[${jobName}] Entity Normalization completed. Processed: ${processed}, Errors: ${errors}.`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR in Entity Normalization: ${e.stack}`);
  }
  Utilities.sleep(10000); // 间隔10秒，避免紧密调用

  // --- B. 智能实体信息丰富 ---
  try {
    Logger.log(`[${jobName}] Running Entity Enrichment Job...`);
    const { processed, errors } = await AnalysisService._intelligentEntityEnrichment();
    Logger.log(`[${jobName}] Entity Enrichment completed. Processed: ${processed}, Errors: ${errors}.`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR in Entity Enrichment: ${e.stack}`);
  }
  Utilities.sleep(10000);

  // --- C. 实体关系构建 ---
  try {
    Logger.log(`[${jobName}] Running Relationship Workflow...`);
    await AnalysisService.runRelationshipWorkflow();
    Logger.log(`[${jobName}] Relationship Workflow completed.`);
  } catch(e) {
    Logger.log(`[${jobName}] ERROR in Relationship Workflow: ${e.stack}`);
  }
  Utilities.sleep(10000);

  // --- D. 技术层级树构建 ---
  try {
    Logger.log(`[${jobName}] Running Hierarchy Workflow...`);
    await AnalysisService.runHierarchyWorkflow();
    Logger.log(`[${jobName}] Hierarchy Workflow completed.`);
  } catch(e) {
    Logger.log(`[${jobName}] ERROR in Hierarchy Workflow: ${e.stack}`);
  }
  Utilities.sleep(10000);

  // --- E. 每日实体快照生成 ---
  try {
    Logger.log(`[${jobName}] Running Daily Snapshot Workflow...`);
    await AnalysisService.runSnapshotWorkflow();
    Logger.log(`[${jobName}] Daily Snapshot Workflow completed.`);
  } catch(e) {
    Logger.log(`[${jobName}] ERROR in Snapshot Workflow: ${e.stack}`);
  }
  
  Logger.log(`--- [${jobName}] Finished Job ---`);
}

/**
 * [低频任务] 每日后台分析与维护总调度。
 * 建议设置为“每日凌晨”（例如 2:00 AM）运行。
 * 这个函数将协调所有每日或不频繁运行的后台任务。
 */
async function runEnrichEntitiesJob() {
  const jobName = 'runEnrichEntitiesJob';
  Logger.log(`--- [${jobName}] Starting Job ---`);

  // --- A. 智能实体标准化与合并 ---
  try {
    Logger.log(`[${jobName}] Running Entity Normalization Job...`);
    const { processed, errors } = await AnalysisService._intelligentEntityNormalization();
    Logger.log(`[${jobName}] Entity Normalization completed. Processed: ${processed}, Errors: ${errors}.`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR in Entity Normalization: ${e.stack}`);
  }
  Utilities.sleep(10000); // 间隔10秒，避免紧密调用

  // --- B. 智能实体信息丰富 ---
  try {
    Logger.log(`[${jobName}] Running Entity Enrichment Job...`);
    const { processed, errors } = await AnalysisService._intelligentEntityEnrichment();
    Logger.log(`[${jobName}] Entity Enrichment completed. Processed: ${processed}, Errors: ${errors}.`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR in Entity Enrichment: ${e.stack}`);
  }
  Utilities.sleep(10000);

  Logger.log(`--- [${jobName}] Finished Job ---`);
}

//==================================================================
// 4. 工具函数：辅助性任务
//==================================================================

/**
 * 获取当前处理任务队列 (QUEUE_TASKS) 的长度。
 *
 * 该函数会查询 Firestore 中所有处于待处理状态的任务，并返回其数量。
 * @returns {number} 队列中任务的数量，如果发生错误则返回 -1。
 */
function getProcessingQueueLength() {
  try {
    const tasks = DataService.getDataAsObjects('QUEUE_TASKS');
    const queueLength = tasks ? tasks.length : 0;
    Logger.log(`当前处理任务队列的长度: ${queueLength} 个任务。`);
    return queueLength;
  } catch (e) {
    Logger.log(`获取处理任务队列长度时发生错误: ${e.message}`);
    return -1;
  }
}

//==================================================================
// 5. 废弃任务：这些函数不再作为独立的定时任务运行，其功能已整合
//==================================================================

// 注意：以下函数已整合到 runDailyMaintenanceAndAnalysisJob() 中，不应再单独作为触发器
/*
// function runDailyAnalysisJob() { ... } // 旧的每日分析任务
// async function runDailyEntityNormalizationJob() { ... } // 已整合
// async function runDailyEntityEnrichmentJob() { ... } // 已整合
*/
