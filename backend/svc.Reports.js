// 文件名: backend/svc.Reports.gs

/**
 * @file 报告生成服务
 * 负责根据不同类型和周期生成技术洞察报告。
 */

const ReportsService = {

  /**
   * 生成指定类型和周期的技术洞察报告。
   *
   * @param {string} reportType - 报告类型 ('Daily', 'Weekly', 'Monthly', 'Quarterly', 'Annual', 'Custom')
   * @param {string} reportTitle - 报告标题
   * @param {string} periodStartStr - 报告周期开始日期 (YYYY-MM-DD)
   * @param {string} periodEndStr - 报告周期结束日期 (YYYY-MM-DD)
   * @param {Array<string>} techAreas - 覆盖的技术领域 (e.g., ['人工智能', '量子计算'])
   * @param {string} targetAudience - 目标受众 (e.g., '管理层')
   * @param {string} reportOwner - 报告负责人
   * @param {string} userReportSummary - 用户输入的报告摘要
   * @param {string} [additionalRecipientEmail] - 额外接收者邮箱 (可选，如果提供则追加到配置列表)
   * @param {object} [aiOptions] - AI功能启用标志 {aiSummaryEnabled: boolean, aiKeyFindingsEnabled: boolean, aiRecommendationsEnabled: boolean}
   * @returns {object} 包含报告元数据和下载链接的对象
   */
  generateReport: function(reportType, reportTitle, periodStartStr, periodEndStr, techAreas, targetAudience, reportOwner, userReportSummary, additionalRecipientEmail, aiOptions = {}) {
    const today = new Date();
    const periodStart = new Date(periodStartStr + 'T00:00:00Z');
    const periodEnd = new Date(periodEndStr + 'T23:59:59Z');
    const generatedBy = Session.getActiveUser().getEmail() || 'Manual_User'; // 自动化任务将显示脚本拥有者邮箱
    const outputFormat = 'html'; // 报告将生成HTML格式
    const reportId = `REPORT_${Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}_${reportType.toUpperCase()}`;

    Logger.log(`[ReportsService] Generating ${reportType} report '${reportTitle}' from ${periodStartStr} to ${periodEndStr} by ${generatedBy}`);

    try {
      // 1. 根据报告类型和周期，聚合所需数据，并传递AI选项
      const reportData = this._aggregateReportData(reportType, periodStart, periodEnd, techAreas, userReportSummary, aiOptions);
      Logger.log(`[ReportsService] Data aggregated for ${reportType} report.`);

      // 2. 获取邮件接收者列表
      const recipientEmails = this._getReportRecipients(reportType, additionalRecipientEmail);
      Logger.log(`[ReportsService] Recipient emails: ${recipientEmails.join(', ')}`);

      // 3. 生成报告内容 (HTML格式)
      const reportContentHtml = this._generateReportContentHtml(reportType, reportTitle, periodStartStr, periodEndStr, reportData, techAreas, targetAudience, reportOwner, userReportSummary);
      Logger.log(`[ReportsService] HTML content generated for ${reportType} report.`);

      // 4. 将报告内容保存到Google Drive
      const reportFileName = this._generateReportFileName(reportTitle, outputFormat);
      const driveFile = this._saveReportToDrive(reportFileName, reportContentHtml, outputFormat);
      Logger.log(`[ReportsService] Report saved to Drive: ${driveFile.getName()}, ID: ${driveFile.getId()}`);

      // 5. 记录报告生成历史
      const reportMetadata = {
        report_id: reportId,
        report_name: reportTitle,
        report_type: reportType,
        generation_date: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
        report_period_start: Utilities.formatDate(periodStart, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        report_period_end: Utilities.formatDate(periodEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        generated_by: generatedBy,
        drive_file_id: driveFile.getId(),
        download_url: driveFile.getUrl(),
        status: 'Generated',
        recipients: recipientEmails.join(', '), // 记录实际发送的邮箱列表
        created_timestamp: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
        updated_timestamp: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
      };
      this._recordReportHistory(reportMetadata);
      Logger.log(`[ReportsService] Report history recorded.`);

      // 6. 发送邮件
      if (recipientEmails.length > 0 && MailApp) {
        try {
          MailApp.sendEmail({
            to: recipientEmails.join(','),
            subject: `[技术洞察报告] ${reportTitle} - ${reportType} (${periodStartStr}至${periodEndStr})`,
            htmlBody: reportContentHtml,
            name: 'TechInsight AI Engine' // 发件人名称
          });
          Logger.log(`[ReportsService] Report email sent to ${recipientEmails.join(', ')}.`);
        } catch (mailError) {
          Logger.log(`[ReportsService] Failed to send email: ${mailError.message}`);
          this._updateReportHistoryStatus(reportId, 'Generated_Email_Failed'); // 更新状态表示邮件发送失败
        }
      }

      return { success: true, message: `Report '${reportTitle}' generated successfully.`, downloadUrl: driveFile.getUrl() };

    } catch (e) {
      Logger.log(`[ReportsService] Error generating ${reportType} report '${reportTitle}': ${e.message}\n${e.stack}`);
      // 记录失败的报告历史
      const reportMetadata = {
        report_id: reportId,
        report_name: reportTitle,
        report_type: reportType,
        generation_date: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
        report_period_start: Utilities.formatDate(periodStart, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        report_period_end: Utilities.formatDate(periodEnd, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
        generated_by: generatedBy,
        drive_file_id: '',
        download_url: '',
        status: 'Failed',
        recipients: additionalRecipientEmail || userReportSummary, // 记录传入的邮箱或摘要
        created_timestamp: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss'),
        updated_timestamp: Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss')
      };
      this._recordReportHistory(reportMetadata);
      throw new Error(`Failed to generate ${reportType} report '${reportTitle}': ${e.message}`);
    }
  },

  /**
   * 获取所有报告历史记录。
   * @returns {Array<object>} 报告历史记录列表。
   */
    /**
   * 获取所有报告历史记录，支持分页和排序。
   * @param {number} page - 当前页码 (从1开始)。
   * @param {number} limit - 每页记录数。
   * @returns {{records: Array<object>, totalRecords: number}} 报告历史记录列表及总数。
   */
  getReportsHistory: function(page = 1, limit = 15) { // 默认页码1，每页15条
    try {
      const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
      const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY;
      const history = DataService.getDataAsObjects(dbId, sheetName);

      // 1. 格式化日期并进行深度复制，避免修改原始数据
      const formattedHistory = history.map(record => ({
        report_id: record.report_id,
        report_name: record.report_name,
        report_type: record.report_type,
        generation_date: this._formatDate(record.generation_date, true), // 确保是包含时间的完整字符串
        report_period_start: this._formatDate(record.report_period_start),
        report_period_end: this._formatDate(record.report_period_end),
        generated_by: record.generated_by,
        drive_file_id: record.drive_file_id,
        download_url: record.download_url,
        status: record.status,
        recipients: record.recipients,
        created_timestamp: this._formatDate(record.created_timestamp, true),
        updated_timestamp: this._formatDate(record.updated_timestamp, true)
      }));

      // 2. 按 generation_date 倒序排序 (最新在最上面)
      // 使用 new Date() 进行可靠的日期比较
      formattedHistory.sort((a, b) => {
        const dateA = new Date(a.generation_date);
        const dateB = new Date(b.generation_date);
        return dateB.getTime() - dateA.getTime(); // 倒序
      });

      // 3. 计算分页所需的起始和结束索引
      const totalRecords = formattedHistory.length;
      const startIndex = (page - 1) * limit;
      const endIndex = Math.min(startIndex + limit, totalRecords);

      // 4. 获取当前页的数据
      const recordsOnPage = formattedHistory.slice(startIndex, endIndex);

      Logger.log(`[ReportsService] Fetched reports history: page ${page}, limit ${limit}. Total: ${totalRecords}, Returning: ${recordsOnPage.length}`);

      return {
        records: recordsOnPage,
        totalRecords: totalRecords
      };
    } catch (e) {
      Logger.log(`[ReportsService] Error getting reports history with pagination: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve reports history with pagination: ${e.message}`);
    }
  },

  /**
   * 获取所有活跃的技术名称列表。
   * 用于前端页面初始化时填充技术领域复选框。
   * @returns {Array<string>} 活跃技术名称数组。
   */
  getAllActiveTechNames: function() { // ✅ 新增此方法
    try {
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);
      const activeTechs = allTechnologies
        .filter(t => t.monitoring_status && String(t.monitoring_status).toLowerCase() === 'active')
        .map(t => t.tech_name);
      Logger.log(`[ReportsService] Fetched ${activeTechs.length} active tech names.`);
      return activeTechs;
    } catch (e) {
      Logger.log(`[ReportsService] Error getting all active tech names: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve active technology names: ${e.message}`);
    }
  },

  /**
   * 根据指定时间范围，获取在该时间范围内有洞察数据的技术领域名称。
   * @param {string} periodStartStr - 周期开始日期 (YYYY-MM-DD)
   * @param {string} periodEndStr - 周期结束日期 (YYYY-MM-DD)
   * @returns {Array<string>} 在指定时间范围内有洞察数据的技术名称数组。
   */
  getTechAreasWithInsightsInPeriod: function(periodStartStr, periodEndStr) { // ✅ 新增此方法
    try {
      const periodStart = new Date(periodStartStr + 'T00:00:00Z');
      const periodEnd = new Date(periodEndStr + 'T23:59:59Z');

      const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER); // ✅ 语义修改
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);

      const techIdsWithInsights = new Set();
      allInsights.forEach(insight => {
        const insightDate = new Date(insight.created_timestamp);
        // 确保日期有效且在范围内
        if (!isNaN(insightDate.getTime()) && insightDate >= periodStart && insightDate <= periodEnd) {
          if (insight.tech_id) { // 优先使用 tech_id 进行关联
            techIdsWithInsights.add(insight.tech_id);
          } else if (insight.tech_keyword) { // 如果没有 tech_id，尝试使用 tech_keyword
            // 注意：tech_keyword 可能是多个，需要拆分并与 Technology_Registry 关联
            const insightKeywords = String(insight.tech_keyword).toLowerCase().split(',').map(k => k.trim());
            allTechnologies.forEach(tech => {
                const techKeywords = String(tech.tech_keywords || '').toLowerCase().split(',').map(k => k.trim());
                if (insightKeywords.some(ik => techKeywords.includes(ik))) {
                    techIdsWithInsights.add(tech.tech_id);
                }
            });
          }
        }
      });

      const relevantTechNames = allTechnologies
        .filter(tech => tech.monitoring_status && String(tech.monitoring_status).toLowerCase() === 'active' && techIdsWithInsights.has(tech.tech_id))
        .map(tech => tech.tech_name);

      Logger.log(`[ReportsService] Fetched ${relevantTechNames.length} tech names with insights in period ${periodStartStr} to ${periodEndStr}.`);
      return relevantTechNames;
    } catch (e) {
      Logger.log(`[ReportsService] Error getting tech areas with insights in period: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve tech areas with insights: ${e.message}`);
    }
  },

  /**
   * 辅助函数：格式化日期。
   * @param {Date|string} dateValue
   * @param {boolean} includeTime
   * @returns {string} 格式化后的日期字符串
   */
  _formatDate: function(dateValue, includeTime = false) {
    if (!dateValue) return 'N/A';
    let dateObj;
    if (dateValue instanceof Date) {
      dateObj = dateValue;
    } else {
      dateObj = new Date(dateValue);
    }
    if (isNaN(dateObj.getTime())) return String(dateValue); // Return original if invalid date

    const format = includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd';
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
  },

  /**
   * 辅助函数：调用外部AI服务生成文本。
   * @param {string} promptText - 传递给AI模型的Prompt。
   * @param {string} purpose - AI调用的目的 (e.g., 'summary', 'title_generation', 'key_findings').
   * @returns {string} AI生成的文本。
   */
  _callAI: function(promptText, purpose) {
    Logger.log(`[ReportsService] Calling external AI for purpose: ${purpose}. Prompt snippet: ${promptText.substring(0, Math.min(promptText.length, 100))}...`);
    try {
      // **重要：请将您的AI API Key存储在Apps Script的Project Properties中**
      // 步骤：在Apps Script编辑器中，点击左侧的“项目设置”图标（齿轮），
      // 找到“脚本属性”部分，点击“添加脚本属性”，
      // 键 (Property) 填写：`OPENAI_API_KEY` (或您选择的任何名称)
      // 值 (Value) 填写：您的实际 OpenAI API Key
      const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY'); 

      if (!OPENAI_API_KEY) {
        throw new Error("AI API Key未配置。请在Apps Script项目属性中设置。");
      }

      // 根据AI调用目的调整模型和参数
      let model = "gpt-4o-mini"; // 默认使用最新的小模型
      let max_tokens = 500;
      let temperature = 0.7;

      if (purpose === 'summary') {
        max_tokens = 300; // 摘要可以短一些
      } else if (purpose === 'key_findings' || purpose === 'actionable_recommendations') {
        max_tokens = 400; // 发现和建议可能长一些
        temperature = 0.5; // 创造性可以低一些，更注重事实
      } else if (purpose === 'title_generation') {
        max_tokens = 50; // 标题很短
        temperature = 0.9; // 标题需要更多创造性
      }

      const payload = {
        model: model,
        messages: [{ role: "user", content: promptText }],
        max_tokens: max_tokens,
        temperature: temperature,
      };

      const options = {
        method: "post",
        contentType: "application/json",
        headers: {
          "Authorization": "Bearer " + OPENAI_API_KEY,
        },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true // 防止HTTP错误直接抛出异常
      };

      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", options);
      const jsonResponse = JSON.parse(response.getContentText());

      if (response.getResponseCode() === 200) {
        if (jsonResponse.choices && jsonResponse.choices.length > 0 && jsonResponse.choices[0].message) {
          return jsonResponse.choices[0].message.content.trim();
        } else {
          Logger.log(`AI API Response Missing Content: ${JSON.stringify(jsonResponse)}`);
          return "AI生成失败：响应内容为空。";
        }
      } else {
        Logger.log(`AI API Error: ${response.getResponseCode()} - ${JSON.stringify(jsonResponse)}`);
        return `AI生成失败：API错误 (${response.getResponseCode()})。`;
      }
    } catch (e) {
      Logger.log(`[ReportsService] _callAI failed: ${e.message}\n${e.stack}`);
      return `AI生成失败：连接或解析错误 (${e.message})。`;
    }
  },

  /**
   * 根据聚合数据生成HTML格式的报告内容。
   * 嵌入更多AI生成的内容。
   * @param {string} reportType
   * @param {string} reportTitle
   * @param {string} periodStartStr
   * @param {string} periodEndStr
   * @param {object} reportData - 包含所有聚合数据和AI生成内容的报告数据对象
   * @param {Array<string>} techAreas
   * @param {string} targetAudience
   * @param {string} reportOwner
   * @param {string} userReportSummary - 用户输入的摘要
   * @returns {string} 报告内容 (HTML格式)
   */
  _generateReportContentHtml: function(reportType, reportTitle, periodStartStr, periodEndStr, reportData, techAreas, targetAudience, reportOwner, userReportSummary) {
    // 辅助函数：生成星级评分
    const _generateStars = (score) => {
      const parsedScore = parseFloat(score);
      if (isNaN(parsedScore)) return '';
      const fullStars = Math.floor(parsedScore / 2); // 假设1-10分，每2分一颗星
      const halfStar = parsedScore % 2 >= 1 ? '★' : ''; // 半颗星，如果余数大于等于1
      const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
      return '★'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);
    };

    let htmlContent = `
    <!DOCTYPE html>
    <html lang="zh-CN">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>${reportTitle}</title>
        <style>
            body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; line-height: 1.6; color: #333; margin: 0; padding: 0; background-color: #f8f9fa; }
            .container { max-width: 800px; margin: 20px auto; background-color: #fff; border-radius: 8px; box-shadow: 0 4px 15px rgba(0, 0, 0, 0.1); overflow: hidden; }
            .header { background-color: #007bff; color: #fff; padding: 30px 40px; text-align: center; }
            .header h1 { margin: 0; font-size: 2.5em; font-weight: 600; }
            .header p { margin: 5px 0 0; font-size: 1em; opacity: 0.9; }
            .section { padding: 30px 40px; border-bottom: 1px solid #eee; }
            .section:last-child { border-bottom: none; }
            h2 { color: #007bff; font-size: 1.8em; margin-top: 0; border-bottom: 2px solid #007bff; padding-bottom: 10px; margin-bottom: 20px; }
            h3 { color: #555; font-size: 1.4em; margin-top: 20px; margin-bottom: 15px; }
            ul { list-style: none; padding: 0; margin: 0; }
            ul li { margin-bottom: 10px; padding-left: 20px; position: relative; }
            ul li:before { content: '•'; position: absolute; left: 0; color: #007bff; font-weight: bold; }
            .insight-card { background-color: #f9f9f9; border: 1px solid #ddd; border-radius: 8px; padding: 20px; margin-bottom: 20px; }
            .insight-card h3 { color: #007bff; margin-top: 0; margin-bottom: 10px; }
            .insight-card p { margin-bottom: 5px; }
            .insight-card strong { color: #007bff; }
            .star-rating { color: #FFD700; font-size: 1.2em; } /* 金黄色星星 */
            .footer { padding: 20px 40px; text-align: center; font-size: 0.9em; color: #777; background-color: #f0f0f0; border-top: 1px solid #eee; }
            .disclaimer { margin-top: 20px; font-size: 0.8em; color: #a0a0a0; }
            .metric-box { display: flex; justify-content: space-around; text-align: center; margin-bottom: 20px; }
            .metric-box div { flex: 1; padding: 15px; background-color: #e9f5ff; border-radius: 5px; margin: 0 10px; }
            .metric-box .value { font-size: 2em; font-weight: bold; color: #007bff; }
            .metric-box .label { font-size: 0.9em; color: #555; }
        </style>
    </head>
    <body>
        <div class="container">
            <div class="header">
                <h1>${reportTitle}</h1>
                <p><strong>报告类型:</strong> ${reportType} &nbsp; | &nbsp; <strong>报告周期:</strong> ${periodStartStr} 至 ${periodEndStr}</p>
                <p><strong>覆盖技术领域:</strong> ${techAreas.length > 0 ? techAreas.join(', ') : '所有领域'} &nbsp; | &nbsp; <strong>目标受众:</strong> ${targetAudience}</p>
                <p><strong>报告负责人:</strong> ${reportOwner}</p>
            </div>

            <div class="section">
                <h2>深度洞察 (Executive Summary)</h2>
                <p>${userReportSummary}</p>
                ${reportData.aiExecutiveSummary ? `<p><strong>AI智能摘要:</strong> ${reportData.aiExecutiveSummary}</p>` : ''}
            </div>

            <div class="section">
                <h2>核心数据概览</h2>
                <div class="metric-box">
                    <div>
                        <div class="value">${reportData.newSignalCount}</div>
                        <div class="label">新增线索</div>
                    </div>
                    <div>
                        <div class="value">${reportData.verifiedInsightCount}</div>
                        <div class="label">已验证洞察</div>
                    </div>
                    <div>
                        <div class="value">${reportData.completedAnalysisCount}</div>
                        <div class="label">已完成分析</div>
                    </div>
                </div>
            </div>
    `;

    // 动态添加AI生成的关键发现
    if (reportData.aiKeyFindings && reportData.aiKeyFindings.length > 0) {
      htmlContent += `
      <div class="section">
          <h2>关键发现 (Key Findings)</h2>
          <ul>
              ${reportData.aiKeyFindings.map(finding => `<li>${finding}</li>`).join('')}
          </ul>
      </div>
      `;
    }

    // 动态添加AI生成的行动建议
    if (reportData.aiActionableRecommendations && reportData.aiActionableRecommendations.length > 0) {
      htmlContent += `
      <div class="section">
          <h2>行动建议 (Actionable Recommendations)</h2>
          <ul>
              ${reportData.aiActionableRecommendations.map(rec => `<li>${rec}</li>`).join('')}
          </ul>
      </div>
      `;
    }

    // 动态添加AI生成的趋势分析（如果ReportsService._aggregateReportData返回了）
    if (reportData.aiTrendAnalysis) {
        htmlContent += `
        <div class="section">
            <h2>趋势分析 (Trend Analysis)</h2>
            <p>${reportData.aiTrendAnalysis}</p>
        </div>
        `;
    }

    if (reportData.topHighValueInsights && reportData.topHighValueInsights.length > 0) {
      htmlContent += `
            <div class="section">
                <h2>高价值洞察 (Top ${reportData.topHighValueInsights.length})</h2>
      `;
      reportData.topHighValueInsights.forEach((insight, index) => {
        htmlContent += `
                <div class="insight-card">
                    <h3>${index + 1}. ${insight.title}</h3>
                    <p><strong>来源:</strong> ${insight.trigger_source || '未知'} &nbsp; | &nbsp; <strong>数据类型:</strong> ${insight.data_type || '未知'}</p>
                    <p><strong>商业价值评分:</strong> ${insight.commercial_value_score || 'N/A'} <span class="star-rating">${_generateStars(insight.commercial_value_score)}</span></p>
                    <p><strong>信号强度:</strong> ${insight.signal_strength || 'N/A'} <span class="star-rating">${_generateStars(insight.signal_strength)}</span></p>
                    <p><strong>突破性评分:</strong> ${insight.breakthrough_score || 'N/A'} <span class="star-rating">${_generateStars(insight.breakthrough_score)}</span></p>
                    <p><strong>摘要:</strong> ${insight.content_summary || '无'}</p>
                    ${insight.breakthrough_reason ? `<p><strong>突破性分析理由:</strong> ${insight.breakthrough_reason}</p>` : ''}
                    ${insight.value_proposition ? `<p><strong>价值主张:</strong> ${insight.value_proposition}</p>` : ''}
                    ${insight.key_innovations ? `<p><strong>关键创新点:</strong> ${insight.key_innovations}</p>` : ''}
                    ${insight.target_industries ? `<p><strong>目标行业:</strong> ${insight.target_industries}</p>` : ''}
                    ${insight.source_url ? `<p><strong>原始链接:</strong> <a href="${insight.source_url}" target="_blank">${insight.source_url}</a></p>` : ''}
                </div>
        `;
      });
      htmlContent += `
            </div>
      `;
    }

    if (reportData.activeTechDomains && reportData.activeTechDomains.length > 0) {
      htmlContent += `
            <div class="section">
                <h2>活跃技术领域 (Top ${reportData.activeTechDomains.length})</h2>
                <ul>
      `;
      reportData.activeTechDomains.forEach((domain) => {
        htmlContent += `
                    <li><strong>${domain.tech_name}</strong> - 相关洞察数量: ${domain.insight_count} - 平均信号强度: ${domain.avg_signal_strength.toFixed(1)}</li>
        `;
      });
      htmlContent += `
                </ul>
            </div>
      `;
    }

    htmlContent += `
            <div class="footer">
                <p>报告生成时间: ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy年MM月dd日 HH:mm:ss')}</p>
                <p>系统版本: TechInsight智能洞察决策引擎 v2.0</p>
                <p>数据来源: 集成多个权威技术数据库，AI自动分析生成</p>
                <p class="disclaimer">本报告内容仅供内部决策参考，请勿外传</p>
            </div>
        </div>
    </body>
    </html>
    `;

    return htmlContent;
  },

    /**
   * 根据报告类型、周期、技术领域和摘要聚合数据。
   * 这是报告内容的核心数据源。
   * @param {string} reportType
   * @param {Date} periodStart
   * @param {Date} periodEnd
   * @param {Array<string>} techAreas
   * @param {string} userReportSummary - 用户输入的摘要，可能会被AI摘要覆盖
   * @param {object} aiOptions - AI功能启用标志 {aiSummaryEnabled: boolean, aiKeyFindingsEnabled: boolean, aiRecommendationsEnabled: boolean}
   * @returns {object} 聚合后的数据
   */
  _aggregateReportData: function(reportType, periodStart, periodEnd, techAreas, userReportSummary, aiOptions) {
    const data = {
      periodStart: periodStart,
      periodEnd: periodEnd,
      techAreas: techAreas,
      userReportSummary: userReportSummary, // 原始用户摘要
      aiExecutiveSummary: '', // 预留AI摘要字段
      aiKeyFindings: [],     // AI生成的关键发现
      aiActionableRecommendations: [], // AI生成的行动建议
      aiTrendAnalysis: '', // AI生成的趋势分析
    };

    // 示例：获取Tech_Insights_Master数据
    const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
    
    // 过滤时间范围和技术领域
    const insightsInPeriod = allInsights.filter(item => {
      const itemDate = new Date(item.created_timestamp); 
      const isWithinPeriod = itemDate >= periodStart && itemDate <= periodEnd;
      
      const itemTechKeywords = String(item.tech_keyword || '').toLowerCase().split(',').map(k => k.trim());
      const isRelevantTechArea = techAreas.length === 0 || techAreas.some(area => itemTechKeywords.includes(area.toLowerCase()));
      
      return isWithinPeriod && isRelevantTechArea;
    });

    data.totalInsights = insightsInPeriod.length;
    data.newSignalCount = insightsInPeriod.filter(i => String(i.processing_status).includes('signal_identified')).length;
    data.verifiedInsightCount = insightsInPeriod.filter(i => String(i.processing_status).includes('evidence_verified')).length;
    data.completedAnalysisCount = insightsInPeriod.filter(i => String(i.processing_status).includes('completed')).length;

    // 示例：获取高价值洞察 (Top 5 by commercial_value_score)
    data.topHighValueInsights = insightsInPeriod
      .sort((a, b) => (parseFloat(b.commercial_value_score) || 0) - (parseFloat(a.commercial_value_score) || 0))
      .slice(0, 5);

    // 示例：获取活跃技术领域 (从Technology_Registry获取，并计算相关洞察数量)
    const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);
    data.activeTechDomains = allTechnologies.filter(t => t.monitoring_status && String(t.monitoring_status).toLowerCase() === 'active' && 
                                                      (techAreas.length === 0 || techAreas.includes(t.tech_name))) // 仅活跃且在选定技术领域内
                                         .map(t => {
      const relevantInsights = insightsInPeriod.filter(i => i.tech_id === t.tech_id);
      return {
        tech_name: t.tech_name,
        insight_count: relevantInsights.length,
        avg_signal_strength: relevantInsights.length > 0 ? 
                                relevantInsights.reduce((sum, i) => sum + (parseFloat(i.signal_strength) || 0), 0) / relevantInsights.length : 0
      };
    }).sort((a, b) => b.insight_count - a.insight_count).slice(0, 5); // 只取前5个

    // **根据aiOptions动态调用AI功能**
    const insightsDataForAI = data.topHighValueInsights.map(i => ({
      title: i.title,
      summary: i.content_summary,
      commercial_value_score: i.commercial_value_score,
      signal_strength: i.signal_strength,
      breakthrough_score: i.breakthrough_score
    }));

    // AI生成执行摘要
    if (aiOptions.aiSummaryEnabled) {
      const summaryPrompt = `请根据以下技术洞察数据，生成一份简洁、专业的执行摘要（Executive Summary），突出关键发现和建议，字数控制在200字以内。数据：${JSON.stringify({
        totalInsights: data.totalInsights,
        newSignalCount: data.newSignalCount,
        topInsights: insightsDataForAI
      })}`;
      data.aiExecutiveSummary = this._callAI(summaryPrompt, 'summary');
    }

    // AI生成关键发现
    if (aiOptions.aiKeyFindingsEnabled) {
      const findingsPrompt = `基于以下数据，请提取3-5条关键技术发现。数据：${JSON.stringify(insightsDataForAI)}`;
      const rawFindings = this._callAI(findingsPrompt, 'key_findings');
      // 尝试解析为列表，如果AI返回的是逗号或分号分隔的文本，可能需要更复杂的解析
      data.aiKeyFindings = rawFindings.split(/[\n;；]+/).map(s => s.trim()).filter(s => s.length > 0); 
    }

    // AI生成行动建议
    if (aiOptions.aiRecommendationsEnabled) {
      const recommendationsPrompt = `针对以下关键发现（${data.aiKeyFindings.join('；')}），请提出3-5条具体的行动建议。`;
      const rawRecommendations = this._callAI(recommendationsPrompt, 'actionable_recommendations');
      // 尝试解析为列表
      data.aiActionableRecommendations = rawRecommendations.split(/[\n;；]+/).map(s => s.trim()).filter(s => s.length > 0);
    }

    // TODO: AI趋势分析可以类似地实现，需要从InsightsService获取周期性趋势数据
    // 例如：
    // if (aiOptions.aiTrendAnalysisEnabled) {
    //   const trendData = InsightsService.getTrendAnalysisDataForPeriod(periodStart, periodEnd);
    //   const trendPrompt = `请分析以下技术洞察趋势数据（日期：数量）[${JSON.stringify(trendData.xAxis)}]: [${JSON.stringify(trendData.seriesData)}]，并提供一份简要的趋势解读。`;
    //   data.aiTrendAnalysis = this._callAI(trendPrompt, 'trend_analysis');
    // }

    return data;
  },

  /**
   * 将报告内容保存到Google Drive。
   * @param {string} fileName - 文件名 (不含路径)
   * @param {string} content - 报告内容
   * @param {string} format - 文件格式 (html)
   * @returns {GoogleAppsScript.Drive.File} 保存的文件对象
   */
  _saveReportToDrive: function(fileName, content, format) {
    // ✅ 替换为你的Google Drive报告文件夹ID
    const parentFolderId = '1fkVdmHmnuQnSdzorka0UPw4l6MapKhxo'; // 确保ID正确且大小写一致
    
    // 检查文件夹ID是否已设置，或是否是无效的默认占位符
    if (!parentFolderId || parentFolderId === 'YOUR_REPORT_FOLDER_ID_IN_DRIVE') {
        throw new Error("Google Drive 报告文件夹ID未设置。请在 backend/svc.Reports.gs 中配置 'parentFolderId'。");
    }

    const parentFolder = DriveApp.getFolderById(parentFolderId);
    
    let file;
    if (format === 'html') { // 保存为HTML文件
      file = parentFolder.createFile(fileName, content, MimeType.HTML);
    } else { // 默认作为纯文本保存，以防万一
      file = parentFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    }
    
    return file;
  },

  /**
   * 生成报告的文件名。
   * @param {string} reportTitle - 报告标题，用于文件名
   * @param {string} outputFormat - 文件格式 (html)
   * @returns {string} 文件名
   */
  _generateReportFileName: function(reportTitle, outputFormat) {
    // 清理标题中的特殊字符，确保文件名合法
    const cleanTitle = reportTitle.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5 -]/g, '').trim();
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    return `${cleanTitle}_${timestamp}.${outputFormat}`;
  },

  /**
   * 将报告元数据记录到 Reports_History 表。
   * @param {object} metadata - 报告元数据对象
   */
  _recordReportHistory: function(metadata) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB; // TechInsight_Operations_DB
    const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY; 

    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`[ReportsService] Error: Sheet "${sheetName}" not found in DB "${dbId}". Report history not recorded.`);
      return;
    }

    // 确保数据按正确的列顺序写入
    // 根据 Reports_History 表的实际列顺序调整
    sheet.appendRow([
      metadata.report_id,
      metadata.report_name,
      metadata.report_type,
      metadata.generation_date,
      metadata.report_period_start,
      metadata.report_period_end,
      metadata.generated_by,
      metadata.drive_file_id,
      metadata.download_url,
      metadata.status,
      metadata.recipients,
      metadata.created_timestamp,
      metadata.updated_timestamp
    ]);
  },

  /**
   * 更新 Reports_History 表中的报告状态。
   * 用于更新邮件发送失败等情况。
   * @param {string} reportId - 报告ID
   * @param {string} newStatus - 新状态
   */
  _updateReportHistoryStatus: function(reportId, newStatus) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY;
    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(sheetName);
    if (!sheet) {
      Logger.log(`[ReportsService] Error: Sheet "${sheetName}" not found for status update.`);
      return;
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0]; // 假设第一行是英文表头
    const statusColIndex = headers.indexOf('status');
    const reportIdColIndex = headers.indexOf('report_id');

    if (statusColIndex === -1 || reportIdColIndex === -1) {
      Logger.log(`[ReportsService] Error: 'status' or 'report_id' column not found in ${sheetName}.`);
      return;
    }

    for (let i = 2; i < data.length; i++) { // 从第三行开始查找数据
      if (data[i][reportIdColIndex] === reportId) {
        sheet.getRange(i + 1, statusColIndex + 1).setValue(newStatus);
        Logger.log(`[ReportsService] Report ${reportId} status updated to ${newStatus}.`);
        return;
      }
    }
    Logger.log(`[ReportsService] Report ${reportId} not found for status update.`);
  },

  /**
   * 获取报告接收者列表。
   * @param {string} reportType - 报告类型 (Daily, Weekly, Monthly, Annual, Default)
   * @param {string} [additionalRecipientEmail] - 额外接收者邮箱，如果提供则追加到列表
   * @returns {Array<string>} 接收者邮箱列表
   */
  _getReportRecipients: function(reportType, additionalRecipientEmail) {
    const recipients = new Set(); // 使用Set去重

    try {
      const dbId = CONFIG.DATABASE_IDS.CONFIG_DB; // 接收者配置在Config_DB
      const sheetName = CONFIG.SHEET_NAMES.REPORT_RECIPIENTS; // 新增的接收者表名

      const allRecipients = DataService.getDataAsObjects(dbId, sheetName);

      // 添加特定报告类型和默认类型的接收者
      allRecipients.forEach(record => {
        if (record.is_active && (String(record.is_active).toLowerCase() === 'true' || record.is_active === true)) {
          if (record.report_type === reportType || record.report_type === 'Default') {
            if (record.recipient_email && Utilities.validateEmail(record.recipient_email)) { // 验证邮箱格式
              recipients.add(record.recipient_email.toLowerCase());
            }
          }
        }
      });
    } catch (e) {
      Logger.log(`[ReportsService] Error fetching recipients from config: ${e.message}`);
      // 如果获取配置失败，不中断，继续使用额外邮箱
    }

    // 添加额外接收者邮箱（如果提供且有效）
    if (additionalRecipientEmail && String(additionalRecipientEmail).trim().length > 0) {
      recipients.add(additionalRecipientEmail.toLowerCase());
    }

    return Array.from(recipients);
  },

  /**
   * 获取所有活跃自动化报告任务的最新运行状态。
   * @returns {Array<object>} 活跃任务的状态列表。
   */
  getScheduledReportsStatus: function() {
    try {
      const dbId = CONFIG.DATABASE_IDS.CONFIG_DB;
      const sheetName = CONFIG.SHEET_NAMES.SCHEDULED_REPORTS_CONFIG;
      const configs = DataService.getDataAsObjects(dbId, sheetName);

      if (!configs || configs.length === 0) {
        Logger.log("[ReportsService] No scheduled report configurations found.");
        return [];
      }

      // 过滤出活跃的任务，并提取关键状态信息
      const activeTasksStatus = configs.filter(c => String(c.is_active).toLowerCase() === 'true')
                                       .map(c => ({
                                           job_id: c.job_id,
                                           report_type: c.report_type,
                                           report_title_template: c.report_title_template,
                                           last_run_timestamp: this._formatDate(c.last_run_timestamp, true), // 包含时间
                                           last_run_status: c.last_run_status,
                                           description: c.description // 包含任务描述，用于显示错误详情
                                       }));
      
      Logger.log(`[ReportsService] Fetched ${activeTasksStatus.length} active scheduled report statuses.`);
      return activeTasksStatus;

    } catch (e) {
      Logger.log(`[ReportsService] Error getting scheduled reports status: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve scheduled reports status: ${e.message}`);
    }
  },

  // ✅ 辅助函数：调用外部AI服务生成摘要 (占位符)
  // 你需要替换这里的实现，调用实际的AI API (如OpenAI, Gemini等)
  // 这通常涉及到 UrlFetchApp 来发送 HTTP 请求到 AI 服务的 API 端点
  _callExternalAIForSummary: function(prompt) {
    // 这是一个模拟实现，你需要替换为实际的AI API调用
    // 例如，使用 UrlFetchApp.fetch()
    Logger.log(`[ReportsService] Calling external AI with prompt: ${prompt.substring(0, 100)}...`);
    try {
        // const OPENAI_API_KEY = "sk-proj"; // 存储在Apps Script的User Properties中更安全
        // const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
        //     method: "post",
        //     headers: {
        //         "Authorization": "Bearer " + OPENAI_API_KEY,
        //         "Content-Type": "application/json",
        //     },
        //     payload: JSON.stringify({
        //         model: "gpt-3.5-turbo", // 或其他模型
        //         messages: [{ role: "user", content: prompt }],
        //         max_tokens: 200,
        //         temperature: 0.7,
        //     }),
        //     muteHttpExceptions: true // 防止HTTP错误直接抛出异常
        // });
        // const jsonResponse = JSON.parse(response.getContentText());
        // if (response.getResponseCode() === 200) {
        //     return jsonResponse.choices[0].message.content.trim();
        // } else {
        //     Logger.log(`AI API Error: ${response.getResponseCode()} - ${jsonResponse.error.message}`);
        //     return "AI摘要生成失败：API错误。";
        // }
        return "AI智能摘要：本期报告聚焦前沿技术发展，识别出高价值洞察，主要集中在人工智能和智能体领域。建议密切关注智能体互联网和AI驱动威胁检测技术，其商业价值和信号强度均显示出较高潜力。系统整体运行平稳，数据质量良好。"; // 模拟AI摘要
    } catch (e) {
        Logger.log(`[ReportsService] _callExternalAIForSummary failed: ${e.message}`);
        return "AI摘要生成失败：连接或解析错误。";
    }
  }
};
