// 文件名: backend/jobs.gs (扩展版)

/**
 * @file 自动化报告任务调度器和每日技术洞察情报管线主调度器。
 * 负责读取计划任务配置，计算报告周期，并触发报告生成。
 * 同时，包含按顺序执行数据采集、信号识别和证据验证工作流的主管线。
 */

/**
 * 主调度函数，由Apps Script的时间驱动触发器调用。
 * 遍历Scheduled_Reports_Config表，触发所有活跃的自动化报告任务。
 */
function scheduleAllReports() {
  Logger.log("--- [JOB START] 开始执行所有计划报告任务 ---");
  
  try {
    const allConfigs = DataService.getDataAsObjects('SCHEDULED_REPORTS_CONFIG');
    if (!allConfigs || allConfigs.length === 0) {
      Logger.log("未找到任何计划报告配置，任务结束。");
      return;
    }

    const today = new Date();
    // getDay() 返回 0 (周日) 到 6 (周六)
    const dayOfWeek = today.getDay(); 
    // getDate() 返回月份中的第几天 (1-31)
    const dayOfMonth = today.getDate();

    allConfigs.forEach(config => {
      // 1. 检查任务是否被激活
      if (String(config.is_active).toLowerCase() !== 'true') {
        Logger.log(`跳过任务 (未激活): ${config.job_id || '未知ID'}`);
        return; // continue to the next item in forEach
      }
      
      // 2. 核心逻辑：检查今天是否是这个任务的预定执行日
      let shouldRunToday = false;
      const frequency = String(config.schedule_frequency || '').toUpperCase();

      switch (frequency) {
        case 'DAILY':
          shouldRunToday = true;
          break;
        case 'WEEKLY_MONDAY': // 每周一执行
          if (dayOfWeek === 1) { // 1 代表周一
            shouldRunToday = true;
          }
          break;
        case 'MONTHLY_1ST': // 每月1号执行
          if (dayOfMonth === 1) {
            shouldRunToday = true;
          }
          break;
        // 可以在此添加更多自定义频率规则
        default:
          Logger.log(`未知的调度频率 '${frequency}'，跳过任务: ${config.job_id || '未知ID'}`);
          return; // continue
      }

      // 如果今天不是执行日，则跳过此任务
      if (!shouldRunToday) {
        Logger.log(`今天不是任务 '${config.job_id || '未知ID'}' 的执行日，跳过。`);
        return; // continue
      }

      // 3. 如果需要执行，则准备所有参数
      Logger.log(`✅ 符合执行条件，正在处理任务: ${config.job_id} - ${config.report_title_template}`);
      
      try {
        // 3a. 计算报告的开始和结束日期
        const { periodStartStr, periodEndStr } = calculatePeriodDates(frequency);

        // 3b. ✅ 核心：动态生成报告标题
        const reportTitle = replaceTitlePlaceholders(config.report_title_template, periodStartStr, periodEndStr);
        Logger.log(`动态生成报告标题: "${reportTitle}"`);

        // 3c. 准备其他参数
        const techAreas = config.default_tech_areas ? String(config.default_tech_areas).split(',').map(s => s.trim()).filter(Boolean) : [];
        const recipientEmails = config.recipient_emails || '';
        const reportOwner = config.report_owner || '自动化系统';
        const targetAudience = config.target_audience || '默认受众';
        const description = config.description || '由系统根据预设规则自动生成的报告。';

        // 4. 调用报告生成服务
        ReportsService.generateReport(
          config.report_type,
          reportTitle, // <-- 使用我们刚刚处理好的动态标题
          periodStartStr,
          periodEndStr,
          techAreas,
          targetAudience,
          reportOwner,
          description,
          recipientEmails
        );

        // 5. 更新任务状态为成功
        DataService.updateObject('SCHEDULED_REPORTS_CONFIG', config.id, {
            last_run_timestamp: new Date(),
            last_run_status: 'SUCCESS',
            last_run_error_message: '' // 清空上次的错误信息
        });
        Logger.log(`✅ 报告任务 '${config.job_id}' 生成成功。`);

      } catch (e) {
        // 如果单个报告生成失败，记录错误并继续处理下一个任务
        Logger.log(`❌ 报告任务 '${config.job_id}' 生成失败: ${e.message}`);
        DataService.updateObject('SCHEDULED_REPORTS_CONFIG', config.id, {
            last_run_timestamp: new Date(),
            last_run_status: 'FAILED',
            last_run_error_message: e.message // 记录详细错误信息
        });
      }
    });

  } catch (e) {
    // 如果在获取配置等初始步骤就发生严重错误，则记录并退出
    Logger.log(`❌ 调度器主函数发生严重错误: ${e.message}\n${e.stack}`);
    // 可以在这里给管理员发邮件通知整个调度任务失败
  }
  Logger.log("--- [JOB END] 所有计划报告任务执行完毕 ---");
}

/**
 * 根据频率计算报告的开始和结束日期。
 * @param {string} frequency - 调度频率，例如 'DAILY', 'WEEKLY_MONDAY', 'MONTHLY_1ST'
 * @returns {{periodStartStr: string, periodEndStr: string}}
 */
function calculatePeriodDates(frequency) {
  const today = new Date();
  today.setHours(0, 0, 0, 0); // 将时间设为00:00:00，避免当天数据丢失

  let periodStart = new Date();
  let periodEnd = new Date();

  switch (frequency) {
    case 'DAILY':
      periodEnd = new Date(today);
      periodEnd.setDate(today.getDate() - 1); // 昨天的结束
      periodStart = new Date(periodEnd); // 昨天的开始
      break;
    case 'WEEKLY_MONDAY': // 每周一生成上周报告 (周一到周日)
      // 获取上周日
      periodEnd = new Date(today);
      periodEnd.setDate(today.getDate() - today.getDay()); // 设置到上周日 (如果今天是周日则为今天，否则是上周日)
      if (today.getDay() === 0) { // 如果今天是周日，需要再减7天到上上周日
        periodEnd.setDate(periodEnd.getDate() - 7);
      }
      // 获取上周一
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodStart.getDate() - 6);
      break;
    case 'MONTHLY_1ST': // 每月1日生成上月报告
      periodEnd = new Date(today.getFullYear(), today.getMonth(), 0); // 上月最后一天
      periodStart = new Date(today.getFullYear(), today.getMonth() - 1, 1); // 上月第一天
      break;
    case 'QUARTERLY_1ST_MONTH': // 每季度第一个月1日生成上季度报告
      const currentMonth = today.getMonth(); // 0-11
      let startMonthOfQuarter = 0; // 上季度开始月份
      if (currentMonth >= 0 && currentMonth <= 2) { // Q1 (Jan-Mar) -> Report Q4 last year
        startMonthOfQuarter = 9; // Oct
        periodStart = new Date(today.getFullYear() - 1, startMonthOfQuarter, 1);
        periodEnd = new Date(today.getFullYear() - 1, startMonthOfQuarter + 3, 0);
      } else if (currentMonth >= 3 && currentMonth <= 5) { // Q2 (Apr-Jun) -> Report Q1 this year
        startMonthOfQuarter = 0; // Jan
        periodStart = new Date(today.getFullYear(), startMonthOfQuarter, 1);
        periodEnd = new Date(today.getFullYear(), startMonthOfQuarter + 3, 0);
      } else if (currentMonth >= 6 && currentMonth <= 8) { // Q3 (Jul-Sep) -> Report Q2 this year
        startMonthOfQuarter = 3; // Apr
        periodStart = new Date(today.getFullYear(), startMonthOfQuarter, 1);
        periodEnd = new Date(today.getFullYear(), startMonthOfQuarter + 3, 0);
      } else { // Q4 (Oct-Dec) -> Report Q3 this year
        startMonthOfQuarter = 6; // Jul
        periodStart = new Date(today.getFullYear(), startMonthOfQuarter, 1);
        periodEnd = new Date(today.getFullYear(), startMonthOfQuarter + 3, 0);
      }
      break;
    case 'ANNUAL_JAN_1ST': // 每年1月1日生成上年度报告
      periodStart = new Date(today.getFullYear() - 1, 0, 1); // 上一年1月1日
      periodEnd = new Date(today.getFullYear() - 1, 11, 31); // 上一年12月31日
      break;
    case 'DAILY_ROLLING_7_DAYS':
      periodEnd = new Date(today);
      periodEnd.setDate(today.getDate() - 1); // 报告结束日期是昨天
      periodStart = new Date(periodEnd);
      periodStart.setDate(periodEnd.getDate() - 6); // 报告开始日期是昨天往前数6天（共7天）
      break;
    default:
      // 默认处理，例如假设为日报
      periodEnd = new Date(today);
      periodEnd.setDate(today.getDate() - 1);
      periodStart = new Date(periodEnd);
      break;
  }

  // 格式化日期为 YYYY-MM-DD 字符串
  const formatToYYYYMMDD = (date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    periodStartStr: formatToYYYYMMDD(periodStart),
    periodEndStr: formatToYYYYMMDD(periodEnd)
  };
}

function replaceTitlePlaceholders(template, periodStartStr, periodEndStr) {
  if (!template) return "未命名报告";

  const startDate = new Date(periodStartStr);
  
  // 检查日期是否有效，无效则直接返回模板
  if (isNaN(startDate.getTime())) {
    return template;
  }

  const year = startDate.getFullYear();
  const month = startDate.getMonth() + 1; // 月份从0开始
  const day = startDate.getDate();
  const quarter = Math.floor(month / 3) + 1;

  let title = template
    .replace(/{YYYY}/g, year)
    .replace(/{YEAR}/g, year)
    .replace(/{MM}/g, String(month).padStart(2, '0'))
    .replace(/{MONTH}/g, month)
    .replace(/{DD}/g, String(day).padStart(2, '0'))
    .replace(/{DAY}/g, day)
    .replace(/{QUARTER}/g, `Q${quarter}`);

  // 智能处理 {DATE} 占位符
  if (periodStartStr === periodEndStr) {
    // 如果是日报
    title = title.replace(/{DATE}/g, periodStartStr);
  } else {
    // 如果是周报、月报等
    title = title.replace(/{DATE}/g, `${periodStartStr}至${periodEndStr}`);
  }

  return title;
}

/**
 * 更新 Firestore 中任务的上次运行时间和状态。
 * @param {string} jobId - 任务的 job_id，现在是 Firestore 文档 ID。
 * @param {string} status - 运行状态 ('SUCCESS' 或 'FAILED')。
 * @param {string} [errorMessage] - 如果失败，可选的错误信息。
 */
function updateScheduledReportStatus(jobId, status, errorMessage = '') {
  try {
    // 准备要更新的数据对象
    const dataToUpdate = {
      last_run_timestamp: new Date(), // FirestoreService 会自动处理 Date 对象
      last_run_status: status
    };

    // 如果任务失败，添加错误信息。建议使用一个新字段，而不是覆盖 description
    if (status === 'FAILED') {
      dataToUpdate.last_run_error_message = errorMessage;
    } else {
      // 成功时，可以清空之前的错误信息
      dataToUpdate.last_run_error_message = '';
    }

    // ✅ 使用新的 DataService.updateObject 方法直接更新文档
    // 第一个参数是 CONFIG.FIRESTORE_COLLECTIONS 中的键名
    // 第二个参数是文档 ID (jobId)
    // 第三个参数是包含更新数据的对象
    DataService.updateObject('SCHEDULED_REPORTS_CONFIG', jobId, dataToUpdate);

    Logger.log(`Task '${jobId}' status updated to ${status}.`);

  } catch (e) {
    // 错误日志记录保持不变
    Logger.log(`Error updating scheduled report status for '${jobId}': ${e.message}\n${e.stack}`);
  }
}


/**
 * @function runDailyIntelligencePipeline
 * @description 每日技术洞察情报管线主调度函数。
 * 负责按顺序执行数据采集、信号识别和证据验证工作流。
 * 建议为此函数单独设置一个时间驱动触发器。
 */
function runDailyIntelligencePipeline() {
  Logger.log("--- [PIPELINE START] Starting daily intelligence pipeline ---");
  const overallStartTime = new Date();
  let overallSuccess = true;
  const overallExecutionId = `pipeline_${overallStartTime.getTime()}`; // 为本次管线运行生成唯一ID
  let pipelineLogMessages = []; // 累积管线执行日志

  try {
    pipelineLogMessages.push(`Pipeline ID: ${overallExecutionId}`);
    pipelineLogMessages.push(`Started at: ${overallStartTime.toISOString()}`);

    // ====================================================================
    // 第一层：数据采集工作流 (WF1 - WF6) - 这些工作流可以并行执行，但为了简化逻辑，我们按顺序调用
    // 它们负责从外部源收集数据，并进行初步的AI预处理。
    // ====================================================================

    Logger.log("[PIPELINE] Executing Layer 1: Data Collection Workflows (WF1-WF6)");

    // WF1: 学术论文监控
    pipelineLogMessages.push("\n--- Executing WF1: Academic Papers ---");
    const wf1Result = WorkflowsService.runWf1_AcademicPapers();
    pipelineLogMessages.push(`WF1 Result: ${wf1Result.success ? "SUCCESS" : "FAILED"} - ${wf1Result.message}`);
    if (!wf1Result.success) overallSuccess = false;

    // WF2: 专利申请追踪
    pipelineLogMessages.push("\n--- Executing WF2: Patent Data ---");
    const wf2Result = WorkflowsService.runWf2_PatentData();
    pipelineLogMessages.push(`WF2 Result: ${wf2Result.success ? "SUCCESS" : "FAILED"} - ${wf2Result.message}`);
    if (!wf2Result.success) overallSuccess = false;

    // WF3: 开源项目监测
    pipelineLogMessages.push("\n--- Executing WF3: Open Source Projects ---");
    const wf3Result = WorkflowsService.runWf3_OpenSource();
    pipelineLogMessages.push(`WF3 Result: ${wf3Result.success ? "SUCCESS" : "FAILED"} - ${wf3Result.message}`);
    if (!wf3Result.success) overallSuccess = false;

    // WF4: 技术新闻获取
    pipelineLogMessages.push("\n--- Executing WF4: Tech News ---");
    const wf4Result = WorkflowsService.runWf4_TechNews();
    pipelineLogMessages.push(`WF4 Result: ${wf4Result.success ? "SUCCESS" : "FAILED"} - ${wf4Result.message}`);
    if (!wf4Result.success) overallSuccess = false;

    // WF5: 产业动态捕获
    pipelineLogMessages.push("\n--- Executing WF5: Industry Dynamics ---");
    const wf5Result = WorkflowsService.runWf5_IndustryDynamics();
    pipelineLogMessages.push(`WF5 Result: ${wf5Result.success ? "SUCCESS" : "FAILED"} - ${wf5Result.message}`);
    if (!wf5Result.success) overallSuccess = false;

    // WF6: 业界标杆收集
    pipelineLogMessages.push("\n--- Executing WF6: Benchmark Intelligence ---");
    const wf6Result = WorkflowsService.runWf6_Benchmark();
    pipelineLogMessages.push(`WF6 Result: ${wf6Result.success ? "SUCCESS" : "FAILED"} - ${wf6Result.message}`);
    if (!wf6Result.success) overallSuccess = false;

    // ====================================================================
    // 第二层：信号识别工作流 (WF7-1 to WF7-6) - 这些工作流处理第一层收集到的“pending”状态的原始数据
    // 它们应该在对应的采集工作流之后运行，以确保处理最新的数据。
    // ====================================================================

    Logger.log("[PIPELINE] Executing Layer 2: Signal Identification Workflows (WF7-1 to WF7-6)");

    // WF7-1: 学术论文信号识别
    pipelineLogMessages.push("\n--- Executing WF7-1: Academic Signal Identification ---");
    const wf7_1Result = WorkflowsService.runWf7_1_AcademicSignalIdentification();
    pipelineLogMessages.push(`WF7-1 Result: ${wf7_1Result.success ? "SUCCESS" : "FAILED"} - ${wf7_1Result.message}`);
    if (!wf7_1Result.success) overallSuccess = false;

    // WF7-2: 专利数据信号识别
    pipelineLogMessages.push("\n--- Executing WF7-2: Patent Signal Identification ---");
    const wf7_2Result = WorkflowsService.runWf7_2_PatentSignal();
    pipelineLogMessages.push(`WF7-2 Result: ${wf7_2Result.success ? "SUCCESS" : "FAILED"} - ${wf7_2Result.message}`);
    if (!wf7_2Result.success) overallSuccess = false;

    // WF7-3: 开源项目信号识别
    pipelineLogMessages.push("\n--- Executing WF7-3: Open Source Signal Identification ---");
    const wf7_3Result = WorkflowsService.runWf7_3_OpenSourceSignal();
    pipelineLogMessages.push(`WF7-3 Result: ${wf7_3Result.success ? "SUCCESS" : "FAILED"} - ${wf7_3Result.message}`);
    if (!wf7_3Result.success) overallSuccess = false;

    // WF7-4: 技术新闻信号识别
    pipelineLogMessages.push("\n--- Executing WF7-4: Tech News Signal Identification ---");
    const wf7_4Result = WorkflowsService.runWf7_4TechNewsSignal();
    pipelineLogMessages.push(`WF7-4 Result: ${wf7_4Result.success ? "SUCCESS" : "FAILED"} - ${wf7_4Result.message}`);
    if (!wf7_4Result.success) overallSuccess = false;

    // WF7-5: 产业动态信号识别
    pipelineLogMessages.push("\n--- Executing WF7-5: Industry Dynamics Signal Identification ---");
    const wf7_5Result = WorkflowsService.runWf7_5IndustryDynamics();
    pipelineLogMessages.push(`WF7-5 Result: ${wf7_5Result.success ? "SUCCESS" : "FAILED"} - ${wf7_5Result.message}`);
    if (!wf7_5Result.success) overallSuccess = false;

    // WF7-6: 竞争对手信号识别
    pipelineLogMessages.push("\n--- Executing WF7-6: Competitor Signal Identification ---");
    const wf7_6Result = WorkflowsService.runWf7_6Benchmark();
    pipelineLogMessages.push(`WF7-6 Result: ${wf7_6Result.success ? "SUCCESS" : "FAILED"} - ${wf7_6Result.message}`);
    if (!wf7_6Result.success) overallSuccess = false;

    // ====================================================================
    // 第三层：统一证据验证 (WF8) - 这个工作流处理所有已识别的信号，无论其来源如何。
    // 它应该在所有WF7-X工作流完成之后运行。
    // ====================================================================

    Logger.log("[PIPELINE] Executing Layer 3: Unified Evidence Validation (WF8)");

    // WF8: 统一证据验证
    pipelineLogMessages.push("\n--- Executing WF8: Unified Evidence Validation ---");
    const wf8Result = WorkflowsService.runWf8_EvidenceValidation();
    pipelineLogMessages.push(`WF8 Result: ${wf8Result.success ? "SUCCESS" : "FAILED"} - ${wf8Result.message}`);
    if (!wf8Result.success) overallSuccess = false;


    // ==================================================================
    //  ✅ 新增：第七层 - 专家网络构建 (WF-AG)
    //  在所有数据采集和识别之后运行
    // ==================================================================
    Logger.log("[PIPELINE] Executing Layer 7: Expert Network Graph Building (WF-AG)");
    pipelineLogMessages.push("\n--- Executing WF-AG: Expert Network Graph Builder ---");
    const wfAgResult = WorkflowsService.runWf_AuthorGraphBuilder();
    pipelineLogMessages.push(`WF-AG Result: ${wfAgResult.success ? "SUCCESS" : "FAILED"} - ${wfAgResult.message}`);
    if (!wfAgResult.success) overallSuccess = false; // 如果图谱构建失败，标记整个管线运行不完全成功

    Logger.log("[PIPELINE] All scheduled workflows completed.");

  } catch (e) {
    Logger.log(`!!! CRITICAL PIPELINE ERROR: ${e.message}\n${e.stack}`);
    pipelineLogMessages.push(`\n!!! CRITICAL PIPELINE ERROR: ${e.message}`);
    overallSuccess = false;
  } finally {
    const overallEndTime = new Date();
    const overallDuration = (overallEndTime.getTime() - overallStartTime.getTime()) / 1000;
    // 使用小写状态与_logExecution保持一致
    const finalStatus = overallSuccess ? "completed" : "failed";
    const summaryMsg = `Daily intelligence pipeline finished. Status: ${finalStatus}. Duration: ${overallDuration} seconds.`;

    // 记录整个管线的执行日志
    // 注意：这里的 processedCount/successCount/errorCount 无法简单聚合，
    // 因为每个子工作流都有自己的计数。这里主要记录管线自身的成功/失败状态。
    WorkflowsService._logExecution(
      "Daily Intelligence Pipeline", // 工作流名称
      overallExecutionId, // 执行ID
      overallStartTime, // 开始时间
      finalStatus, // 状态
      0, // processedCount (不易聚合，可根据需要调整)
      overallSuccess ? 1 : 0, // successCount (管线本身是否成功)
      overallSuccess ? 0 : 1, // errorCount (管线本身是否失败)
      summaryMsg + "\n\nDetailed Workflow Results:\n" + pipelineLogMessages.join("\n") // 详细日志
    );
    Logger.log("--- [PIPELINE END] Daily intelligence pipeline finished ---");
  }
}

