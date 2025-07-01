// 文件名: backend/jobs.gs

/** @global CONFIG */
/** @global DataService */
/** @global ReportsService */
/** @global DateUtils */
/** @global Utilities */
/** @global Session */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

/**
 * @file 自动化报告任务调度器。
 * 负责读取计划任务配置，计算报告周期，并触发报告生成。
 */

/**
 * 主调度函数，由Apps Script的时间驱动触发器调用。
 * 遍历Scheduled_Reports_Config表，触发所有活跃的自动化报告任务。
 */
function scheduleAllReports() {
  logInfo("--- 开始执行所有计划报告任务 ---");
  const scriptProperties = PropertiesService.getScriptProperties(); // 用于获取API Key等

  try {
    const scheduledConfigs = DataService.getDataAsObjects(
      CONFIG.DATABASE_IDS.CONFIG_DB,
      CONFIG.SHEET_NAMES.SCHEDULED_REPORTS_CONFIG
    );

    if (!scheduledConfigs || scheduledConfigs.length === 0) {
      logInfo("未找到任何计划报告配置。");
      return;
    }

    scheduledConfigs.forEach(config => {
      // 检查任务是否启用
      const isActive = String(config.is_active).toLowerCase() === 'true';
      if (!isActive) {
        logDebug(`跳过任务 (未启用): ${config.job_id} - ${config.report_title_template}`);
        return;
      }

      logInfo(`正在处理计划任务: ${config.job_id} - ${config.report_title_template}`);
      try {
        // 1. 计算报告周期日期
        const { periodStartStr, periodEndStr } = calculatePeriodDates(String(config.schedule_frequency || 'DAILY').toUpperCase());
        
        // 2. 动态生成报告标题
        const reportTitle = replaceTitlePlaceholders(config.report_title_template, periodStartStr, periodEndStr);

        // 3. 提取技术领域（如果配置为逗号分隔字符串）
        const techAreas = config.default_tech_areas ? String(config.default_tech_areas).split(',').map(s => s.trim()).filter(s => s.length > 0) : [];
        
        // 4. 提取接收者邮箱（如果配置为逗号分隔字符串）
        const recipientEmails = config.recipient_emails ? String(config.recipient_emails).split(',').map(s => s.trim()).filter(s => s.length > 0) : [];

        // 5. AI功能启用标志
        const aiOptions = {
          aiSummaryEnabled: String(config.ai_summary_enabled).toLowerCase() === 'true',
          aiKeyFindingsEnabled: String(config.ai_key_findings_enabled).toLowerCase() === 'true',
          aiRecommendationsEnabled: String(config.ai_recommendations_enabled).toLowerCase() === 'true'
        };

        // 6. 调用ReportsService生成报告
        // 传入所有必要参数，包括AI选项
        ReportsService.generateReport(
          config.report_type,
          reportTitle,
          periodStartStr,
          periodEndStr,
          techAreas,
          config.target_audience,
          config.report_owner,
          config.description || "系统自动生成的报告，请查看附件。", // 使用任务描述作为用户摘要
          recipientEmails.join(','), // 传递给 additionalRecipientEmail，在ReportsService内部会被合并
          aiOptions // 传递AI选项
        );

        // 7. 更新任务的上次运行时间和状态
        updateScheduledReportStatus(config.job_id, 'SUCCESS');
        logInfo(`✅ 报告任务 '${config.job_id}' 生成成功。`);

      } catch (e) {
        logError(`❌ 报告任务 '${config.job_id}' 生成失败: ${e.message}\n${e.stack}`);
        updateScheduledReportStatus(config.job_id, 'FAILED', e.message); // 更新失败状态和错误信息
        // 可以在这里发送错误通知邮件给管理员
      }
    });
  } catch (e) {
    logError(`❌ 调度器主函数发生严重错误: ${e.message}\n${e.stack}`);
  }
  logInfo("--- 计划报告任务执行完毕 ---");
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

  return {
    periodStartStr: DateUtils.formatDate(periodStart),
    periodEndStr: DateUtils.formatDate(periodEnd)
  };
}

/**
 * 替换报告标题模板中的占位符。
 * @param {string} template - 报告标题模板字符串。
 * @param {string} periodStartStr - 报告周期开始日期字符串 (YYYY-MM-DD)。
 * @param {string} periodEndStr - 报告周期结束日期字符串 (YYYY-MM-DD)。
 * @returns {string} 替换占位符后的报告标题。
 */
function replaceTitlePlaceholders(template, periodStartStr, periodEndStr) {
  const startDate = new Date(periodStartStr);
  const endDate = new Date(periodEndStr);
  
  const year = startDate.getFullYear();
  const month = startDate.getMonth() + 1;
  const day = startDate.getDate();

  let title = template
    .replace(/{YEAR}/g, year)
    .replace(/{MONTH}/g, month)
    .replace(/{DAY}/g, day);
  
  // 对于 {DATE}，根据报告周期长度选择合适的格式
  if (periodStartStr === periodEndStr) { // 日报
    title = title.replace(/{DATE}/g, `${year}年${month}月${day}日`);
  } else { // 周报、月报等
    title = title.replace(/{DATE}/g, `${periodStartStr}至${periodEndStr}`);
  }
  
  return title;
}

/**
 * 更新Scheduled_Reports_Config表中任务的上次运行时间和状态。
 * @param {string} jobId - 任务的job_id。
 * @param {string} status - 运行状态 ('SUCCESS' 或 'FAILED')。
 * @param {string} [errorMessage] - 如果失败，可选的错误信息。
 */
function updateScheduledReportStatus(jobId, status, errorMessage = '') {
  try {
    const dbId = CONFIG.DATABASE_IDS.CONFIG_DB;
    const sheetName = CONFIG.SHEET_NAMES.SCHEDULED_REPORTS_CONFIG;
    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(sheetName);

    if (!sheet) {
      logError(`[jobs] Error: Sheet "${sheetName}" not found for status update.`);
      return;
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0]; // 第二行是英文表头
    const jobIdColIndex = headers.indexOf('job_id');
    const lastRunTimestampColIndex = headers.indexOf('last_run_timestamp');
    const lastRunStatusColIndex = headers.indexOf('last_run_status');
    const descriptionColIndex = headers.indexOf('description'); // 假设description列也可以用于记录简要错误

    if (jobIdColIndex === -1 || lastRunTimestampColIndex === -1 || lastRunStatusColIndex === -1) {
      logError(`[jobs] Error: Required columns not found in ${sheetName} for status update.`);
      return;
    }

    for (let i = 2; i < data.length; i++) { // 从第三行开始查找数据
      if (String(data[i][jobIdColIndex]).trim() === String(jobId).trim()) {
        const rowRange = sheet.getRange(i + 1, 1, 1, sheet.getLastColumn()); // 获取整行
        const rowValues = rowRange.getValues()[0];

        // 更新时间戳和状态
        rowValues[lastRunTimestampColIndex] = DateUtils.formatDate(new Date(), true); // Use DateUtils
        rowValues[lastRunStatusColIndex] = status;

        // 如果是失败状态，可以在description或专门的错误信息列记录
        if (status === 'FAILED' && descriptionColIndex !== -1) {
            rowValues[descriptionColIndex] = `FAILED: ${errorMessage.substring(0, 200)}... (原描述: ${rowValues[descriptionColIndex] || ''})`;
        }

        rowRange.setValues([rowValues]); // 写入更新后的行
        logDebug(`[jobs] Task '${jobId}' status updated to ${status}.`);
        return;
      }
    }
    logWarning(`[jobs] Task '${jobId}' not found for status update.`);
  } catch (e) {
    logError(`[jobs] Error updating scheduled report status for '${jobId}': ${e.message}\n${e.stack}`);
  }
}