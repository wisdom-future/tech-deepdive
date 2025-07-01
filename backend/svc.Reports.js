// 文件名: backend/svc.Reports.gs

/** @global CONFIG */
/** @global DataService */
/** @global DateUtils */
/** @global Utilities */
/** @global Session */
/** @global MailApp */
/** @global DriveApp */
/** @global MimeType */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

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
    const periodStart = DateUtils.parseDate(periodStartStr); // Use DateUtils
    const periodEnd = DateUtils.parseDate(periodEndStr); // Use DateUtils
    periodEnd.setHours(23, 59, 59, 999); // Ensure end of day

    const generatedBy = Session.getActiveUser().getEmail() || 'Manual_User'; // Automation tasks will show script owner's email
    const outputFormat = 'html'; // Report will be generated in HTML format
    const reportId = `REPORT_${DateUtils.formatDate(today, true, 'yyyyMMddHHmmss')}_${reportType.toUpperCase()}`;

    logInfo(`[ReportsService] Generating ${reportType} report '${reportTitle}' from ${periodStartStr} to ${periodEndStr} by ${generatedBy}`);

    try {
      // 1. Aggregate required data based on report type and period, and pass AI options
      const reportData = this._aggregateReportData(reportType, periodStart, periodEnd, techAreas, userReportSummary, aiOptions);
      logInfo(`[ReportsService] Data aggregated for ${reportType} report.`);

      // 2. Get email recipient list
      const recipientEmails = this._getReportRecipients(reportType, additionalRecipientEmail);
      logInfo(`[ReportsService] Recipient emails: ${recipientEmails.join(', ')}`);

      // 3. Generate report content (HTML format)
      const reportContentHtml = this._generateReportContentHtml(reportType, reportTitle, periodStartStr, periodEndStr, reportData, techAreas, targetAudience, reportOwner, userReportSummary);
      logInfo(`[ReportsService] HTML content generated for ${reportType} report.`);

      // 4. Save report content to Google Drive
      const reportFileName = this._generateReportFileName(reportTitle, outputFormat);
      const driveFile = this._saveReportToDrive(reportFileName, reportContentHtml, outputFormat);
      logInfo(`[ReportsService] Report saved to Drive: ${driveFile.getName()}, ID: ${driveFile.getId()}`);

      // 5. Record report generation history
      const reportMetadata = {
        report_id: reportId,
        report_name: reportTitle,
        report_type: reportType,
        generation_date: DateUtils.formatDate(today, true), // Use DateUtils
        report_period_start: DateUtils.formatDate(periodStart), // Use DateUtils
        report_period_end: DateUtils.formatDate(periodEnd), // Use DateUtils
        generated_by: generatedBy,
        drive_file_id: driveFile.getId(),
        download_url: driveFile.getUrl(),
        status: 'Generated',
        recipients: recipientEmails.join(','), // Record actual emails sent
        created_timestamp: DateUtils.formatDate(today, true), // Use DateUtils
        updated_timestamp: DateUtils.formatDate(today, true) // Use DateUtils
      };
      this._recordReportHistory(reportMetadata);
      logInfo(`[ReportsService] Report history recorded.`);

      // 6. Send email
      if (recipientEmails.length > 0 && MailApp) {
        try {
          MailApp.sendEmail({
            to: recipientEmails.join(','),
            subject: `[技术洞察报告] ${reportTitle} - ${reportType} (${periodStartStr}至${periodEndStr})`,
            htmlBody: reportContentHtml,
            name: 'TechInsight AI Engine' // Sender name
          });
          logInfo(`[ReportsService] Report email sent to ${recipientEmails.join(', ')}.`);
        } catch (mailError) {
          logError(`[ReportsService] Failed to send email: ${mailError.message}\n${mailError.stack}`);
          this._updateReportHistoryStatus(reportId, 'Generated_Email_Failed'); // Update status to indicate email failure
        }
      }

      return { success: true, message: `Report '${reportTitle}' generated successfully.`, downloadUrl: driveFile.getUrl() };

    } catch (e) {
      logError(`[ReportsService] Error generating ${reportType} report '${reportTitle}': ${e.message}\n${e.stack}`);
      // Record failed report history
      const reportMetadata = {
        report_id: reportId,
        report_name: reportTitle,
        report_type: reportType,
        generation_date: DateUtils.formatDate(today, true), // Use DateUtils
        report_period_start: DateUtils.formatDate(periodStart), // Use DateUtils
        report_period_end: DateUtils.formatDate(periodEnd), // Use DateUtils
        generated_by: generatedBy,
        drive_file_id: '',
        download_url: '',
        status: 'Failed',
        recipients: additionalRecipientEmail || userReportSummary, // Record passed email or summary
        created_timestamp: DateUtils.formatDate(today, true), // Use DateUtils
        updated_timestamp: DateUtils.formatDate(today, true) // Use DateUtils
      };
      this._recordReportHistory(reportMetadata);
      throw new Error(`Failed to generate ${reportType} report '${reportTitle}': ${e.message}`);
    }
  },

  /**
   * 获取所有报告历史记录，支持分页和排序。
   * @param {number} page - Current page number (1-based).
   * @param {number} limit - Records per page.
   * @returns {{records: Array<object>, totalRecords: number}} Report history list and total count.
   */
  getReportsHistory: function(page = 1, limit = 15) { // Default page 1, 15 records per page
    try {
      const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
      const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY;
      const history = DataService.getDataAsObjects(dbId, sheetName);

      // 1. Format dates and deep copy to avoid modifying original data
      const formattedHistory = history.map(record => ({
        report_id: record.report_id,
        report_name: record.report_name,
        report_type: record.report_type,
        generation_date: DateUtils.formatDate(record.generation_date, true), // Ensure full string with time
        report_period_start: DateUtils.formatDate(record.report_period_start),
        report_period_end: DateUtils.formatDate(record.report_period_end),
        generated_by: record.generated_by,
        drive_file_id: record.drive_file_id,
        download_url: record.download_url,
        status: record.status,
        recipients: record.recipients,
        created_timestamp: DateUtils.formatDate(record.created_timestamp, true),
        updated_timestamp: DateUtils.formatDate(record.updated_timestamp, true)
      }));

      // 2. Sort in descending order by generation_date (newest on top)
      formattedHistory.sort((a, b) => {
        const dateA = DateUtils.parseDate(a.generation_date); // Use DateUtils
        const dateB = DateUtils.parseDate(b.generation_date); // Use DateUtils
        return dateB.getTime() - dateA.getTime(); // Descending order
      });

      // 3. Calculate start and end indices for pagination
      const totalRecords = formattedHistory.length;
      const startIndex = (page - 1) * limit;
      const endIndex = Math.min(startIndex + limit, totalRecords);

      // 4. Get data for the current page
      const recordsOnPage = formattedHistory.slice(startIndex, endIndex);

      logDebug(`[ReportsService] Fetched reports history: page ${page}, limit ${limit}. Total: ${totalRecords}, Returning: ${recordsOnPage.length}`);

      return {
        records: recordsOnPage,
        totalRecords: totalRecords
      };
    } catch (e) {
      logError(`[ReportsService] Error getting reports history with pagination: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve reports history with pagination: ${e.message}`);
    }
  },

  /**
   * 获取所有活跃的技术名称列表。
   * 用于前端页面初始化时填充技术领域复选框。
   * @returns {Array<string>} 活跃技术名称数组。
   */
  getAllActiveTechNames: function() { // ✅ New method
    try {
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);
      const activeTechs = allTechnologies
        .filter(t => t.monitoring_status && String(t.monitoring_status).toLowerCase() === 'active')
        .map(t => t.tech_name);
      logDebug(`[ReportsService] Fetched ${activeTechs.length} active tech names.`);
      return activeTechs;
    } catch (e) {
      logError(`[ReportsService] Error getting all active tech names: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve active technology names: ${e.message}`);
    }
  },

  /**
   * 根据指定时间范围，获取在该时间范围内有洞察数据的技术领域名称。
   * @param {string} periodStartStr - 周期开始日期 (YYYY-MM-DD)
   * @param {string} periodEndStr - 周期结束日期 (YYYY-MM-DD)
   * @returns {Array<string>} 在指定时间范围内有洞察数据的技术名称数组。
   */
  getTechAreasWithInsightsInPeriod: function(periodStartStr, periodEndStr) { // ✅ New method
    try {
      const periodStart = DateUtils.parseDate(periodStartStr); // Use DateUtils
      const periodEnd = DateUtils.parseDate(periodEndStr); // Use DateUtils
      periodEnd.setHours(23, 59, 59, 999); // Ensure end of day

      const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER); // ✅ Semantic change
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);

      const techIdsWithInsights = new Set();
      allInsights.forEach(insight => {
        const insightDate = DateUtils.parseDate(insight.created_timestamp); // Use DateUtils
        // Ensure date is valid and within range
        if (!isNaN(insightDate.getTime()) && insightDate >= periodStart && insightDate <= periodEnd) {
          if (insight.tech_id) { // Prefer tech_id for association
            techIdsWithInsights.add(insight.tech_id);
          } else if (insight.tech_keyword) { // If no tech_id, try tech_keyword
            // Note: tech_keyword can be multiple, need to split and associate with Technology_Registry
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

      logDebug(`[ReportsService] Fetched ${relevantTechNames.length} tech names with insights in period ${periodStartStr} to ${periodEndStr}.`);
      return relevantTechNames;
    } catch (e) {
      logError(`[ReportsService] Error getting tech areas with insights in period: ${e.message}\n${e.stack}`);
      throw new Error(`Failed to retrieve tech areas with insights: ${e.message}`);
    }
  },

  /**
   * Helper function: Format date.
   * @param {Date|string} dateValue
   * @param {boolean} includeTime
   * @returns {string} Formatted date string
   */
  _formatDate: function(dateValue, includeTime = false) {
    return DateUtils.formatDate(dateValue, includeTime); // Use centralized DateUtils
  },

  /**
   * Helper function: Call external AI service to generate text.
   * @param {string} promptText - Prompt to pass to the AI model.
   * @param {string} purpose - Purpose of the AI call (e.g., 'summary', 'title_generation', 'key_findings').
   * @returns {string} AI-generated text.
   */
  _callAI: function(promptText, purpose) {
    logDebug(`[ReportsService] Calling external AI for purpose: ${purpose}. Prompt snippet: ${promptText.substring(0, Math.min(promptText.length, 100))}...`);
    try {
      // **IMPORTANT: Store your AI API Key in Apps Script's Project Properties**
      // Steps: In the Apps Script editor, click the 'Project settings' icon (gear).
      // Find the 'Script properties' section, click 'Add script property'.
      // For Key, enter: `OPENAI_API_KEY` (or any name you choose)
      // For Value, enter: Your actual OpenAI API Key
      const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY'); 

      if (!OPENAI_API_KEY) {
        throw new Error("AI API Key is not configured. Please set it in Apps Script project properties.");
      }

      // Adjust model and parameters based on AI call purpose
      let model = "gpt-4o-mini"; // Default to the latest small model
      let max_tokens = 500;
      let temperature = 0.7;

      if (purpose === 'summary') {
        max_tokens = 300; // Summaries can be shorter
      } else if (purpose === 'key_findings' || purpose === 'actionable_recommendations') {
        max_tokens = 400; // Findings and recommendations might be longer
        temperature = 0.5; // Less creativity, more factual
      } else if (purpose === 'title_generation') {
        max_tokens = 50; // Titles are short
        temperature = 0.9; // Titles need more creativity
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
        muteHttpExceptions: true // Prevent HTTP errors from throwing exceptions directly
      };

      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", options);
      const jsonResponse = JSON.parse(response.getContentText());

      if (response.getResponseCode() === 200) {
        if (jsonResponse.choices && jsonResponse.choices.length > 0 && jsonResponse.choices[0].message) {
          return jsonResponse.choices[0].message.content.trim();
        } else {
          logWarning(`[ReportsService] AI API Response Missing Content: ${JSON.stringify(jsonResponse)}`);
          return "AI生成失败：响应内容为空。";
        }
      } else {
        logError(`[ReportsService] AI API Error: ${response.getResponseCode()} - ${JSON.stringify(jsonResponse)}`);
        return `AI生成失败：API错误 (${response.getResponseCode()})。`;
      }
    } catch (e) {
      logError(`[ReportsService] _callAI failed: ${e.message}\n${e.stack}`);
      return `AI生成失败：连接或解析错误 (${e.message})。`;
    }
  },

  /**
   * Generate HTML content for the report based on aggregated data.
   * Embed more AI-generated content.
   * @param {string} reportType
   * @param {string} reportTitle
   * @param {string} periodStartStr
   * @param {string} periodEndStr
   * @param {object} reportData - Report data object containing all aggregated data and AI-generated content
   * @param {Array<string>} techAreas
   * @param {string} targetAudience
   * @param {string} reportOwner
   * @param {string} userReportSummary - User-provided summary
   * @returns {string} Report content (HTML format)
   */
  _generateReportContentHtml: function(reportType, reportTitle, periodStartStr, periodEndStr, reportData, techAreas, targetAudience, reportOwner, userReportSummary) {
    // Helper function: Generate star ratings
    const _generateStars = (score) => {
      const parsedScore = parseFloat(score);
      if (isNaN(parsedScore)) return '';
      const fullStars = Math.floor(parsedScore / 2); // Assuming 1-10 points, one star per 2 points
      const halfStar = parsedScore % 2 >= 1 ? '★' : ''; // Half star if remainder is >= 1
      const emptyStars = 5 - fullStars - (halfStar ? 1 : 0);
      return '★'.repeat(fullStars) + halfStar + '☆'.repeat(emptyStars);
    };

    let htmlContent = `
    <!DOCTYPE html>
    <html lang=\"zh-CN\">
    <head>
        <meta charset=\"UTF-8\">
        <meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">
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
            .star-rating { color: #FFD700; font-size: 1.2em; } /* Gold stars */
            .footer { padding: 20px 40px; text-align: center; font-size: 0.9em; color: #777; background-color: #f0f0f0; border-top: 1px solid #eee; }
            .disclaimer { margin-top: 20px; font-size: 0.8em; color: #a0a0a0; }
            .metric-box { display: flex; justify-content: space-around; text-align: center; margin-bottom: 20px; }
            .metric-box div { flex: 1; padding: 15px; background-color: #e9f5ff; border-radius: 5px; margin: 0 10px; }
            .metric-box .value { font-size: 2em; font-weight: bold; color: #007bff; }
            .metric-box .label { font-size: 0.9em; color: #555; }
        </style>
    </head>
    <body>
        <div class=\"container\">
            <div class=\"header\">
                <h1>${reportTitle}</h1>
                <p><strong>报告类型:</strong> ${reportType} &nbsp; | &nbsp; <strong>报告周期:</strong> ${periodStartStr} 至 ${periodEndStr}</p>
                <p><strong>覆盖技术领域:</strong> ${techAreas.length > 0 ? techAreas.join(', ') : '所有领域'} &nbsp; | &nbsp; <strong>目标受众:</strong> ${targetAudience}</p>
                <p><strong>报告负责人:</strong> ${reportOwner}</p>
            </div>

            <div class=\"section\">
                <h2>深度洞察 (Executive Summary)</h2>
                <p>${userReportSummary}</p>
                ${reportData.aiExecutiveSummary ? `
                    <p><strong>AI智能摘要:</strong> ${reportData.aiExecutiveSummary}</p>` : ''}
            </div>

            <div class=\"section\">
                <h2>核心数据概览</h2>
                <div class=\"metric-box\">
                    <div>
                        <div class=\"value\">${reportData.newSignalCount}</div>
                        <div class=\"label\">新增线索</div>
                    </div>
                    <div>
                        <div class=\"value\">${reportData.verifiedInsightCount}</div>
                        <div class=\"label\">已验证洞察</div>
                    </div>
                    <div>
                        <div class=\"value\">${reportData.completedAnalysisCount}</div>
                        <div class=\"label\">已完成分析</div>
                    </div>
                </div>
            </div>
    `;

    // Dynamically add AI-generated Key Findings
    if (reportData.aiKeyFindings && reportData.aiKeyFindings.length > 0) {
      htmlContent += `
      <div class=\"section\">
          <h2>关键发现 (Key Findings)</h2>
          <ul>
              ${reportData.aiKeyFindings.map(finding => `<li>${finding}</li>`).join('')}
          </ul>
      </div>
      `;
    }

    // Dynamically add AI-generated Actionable Recommendations
    if (reportData.aiActionableRecommendations && reportData.aiActionableRecommendations.length > 0) {
      htmlContent += `
      <div class=\"section\">
          <h2>行动建议 (Actionable Recommendations)</h2>
          <ul>
              ${reportData.aiActionableRecommendations.map(rec => `<li>${rec}</li>`).join('')}
          </ul>
      </div>
      `;
    }

    // Dynamically add AI-generated Trend Analysis (if returned by ReportsService._aggregateReportData)
    if (reportData.aiTrendAnalysis) {
        htmlContent += `
        <div class=\"section\">
            <h2>趋势分析 (Trend Analysis)</h2>
            <p>${reportData.aiTrendAnalysis}</p>
        </div>
        `;
    }

    if (reportData.topHighValueInsights && reportData.topHighValueInsights.length > 0) {
      htmlContent += `
            <div class=\"section\">
                <h2>高价值洞察 (Top ${reportData.topHighValueInsights.length})</h2>
      `;
      reportData.topHighValueInsights.forEach((insight, index) => {
        htmlContent += `
                <div class=\"insight-card\">
                    <h3>${index + 1}. ${insight.title}</h3>
                    <p><strong>来源:</strong> ${insight.trigger_source || '未知'} &nbsp; | &nbsp; <strong>数据类型:</strong> ${insight.data_type || '未知'}</p>
                    <p><strong>商业价值评分:</strong> ${insight.commercial_value_score || 'N/A'} <span class=\"star-rating\">${_generateStars(insight.commercial_value_score)}</span></p>
                    <p><strong>信号强度:</strong> ${insight.signal_strength || 'N/A'} <span class=\"star-rating\">${_generateStars(insight.signal_strength)}</span></p>
                    <p><strong>突破性评分:</strong> ${insight.breakthrough_score || 'N/A'} <span class=\"star-rating\">${_generateStars(insight.breakthrough_score)}</span></p>
                    <p><strong>摘要:</strong> ${insight.content_summary || '无'}</p>
                    ${insight.breakthrough_reason ? `<p><strong>突破性分析理由:</strong> ${insight.breakthrough_reason}</p>` : ''}
                    ${insight.value_proposition ? `<p><strong>价值主张:</strong> ${insight.value_proposition}</p>` : ''}
                    ${insight.key_innovations ? `<p><strong>关键创新点:</strong> ${insight.key_innovations}</p>` : ''}
                    ${insight.target_industries ? `<p><strong>目标行业:</strong> ${insight.target_industries}</p>` : ''}
                    ${insight.source_url ? `<p><strong>原始链接:</strong> <a href=\"${insight.source_url}\" target=\"_blank\">${insight.source_url}</a></p>` : ''}
                </div>
        `;
      });
      htmlContent += `
            </div>
      `;
    }

    if (reportData.activeTechDomains && reportData.activeTechDomains.length > 0) {
      htmlContent += `
            <div class=\"section\">
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
            <div class=\"footer\">
                <p>报告生成时间: ${DateUtils.formatDate(new Date(), true, 'yyyy年MM月dd日 HH:mm:ss')}</p>
                <p>系统版本: TechInsight智能洞察决策引擎 v2.0</p>
                <p>数据来源: 集成多个权威技术数据库，AI自动分析生成</p>
                <p class=\"disclaimer\">本报告内容仅供内部决策参考，请勿外传</p>
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
   * @param {string} userReportSummary - User-provided summary, may be overwritten by AI summary
   * @param {object} aiOptions - AI feature flags {aiSummaryEnabled: boolean, aiKeyFindingsEnabled: boolean, aiRecommendationsEnabled: boolean}
   * @returns {object} Aggregated data
   */
  _aggregateReportData: function(reportType, periodStart, periodEnd, techAreas, userReportSummary, aiOptions) {
    const data = {
      periodStart: periodStart,
      periodEnd: periodEnd,
      techAreas: techAreas,
      userReportSummary: userReportSummary, // Original user summary
      aiExecutiveSummary: '', // Placeholder for AI summary
      aiKeyFindings: [],     // AI-generated key findings
      aiActionableRecommendations: [], // AI-generated actionable recommendations
      aiTrendAnalysis: '', // AI-generated trend analysis
    };

    // Example: Get Tech_Insights_Master data
    const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
    
    // Filter by time range and technology area
    const insightsInPeriod = allInsights.filter(item => {
      const itemDate = DateUtils.parseDate(item.created_timestamp); 
      const isWithinPeriod = itemDate >= periodStart && itemDate <= periodEnd;
      
      const itemTechKeywords = String(item.tech_keyword || '').toLowerCase().split(',').map(k => k.trim());
      const isRelevantTechArea = techAreas.length === 0 || techAreas.some(area => itemTechKeywords.includes(area.toLowerCase()));
      
      return isWithinPeriod && isRelevantTechArea;
    });

    data.totalInsights = insightsInPeriod.length;
    data.newSignalCount = insightsInPeriod.filter(i => String(i.processing_status).includes('signal_identified')).length;
    data.verifiedInsightCount = insightsInPeriod.filter(i => String(i.processing_status).includes('evidence_verified')).length;
    data.completedAnalysisCount = insightsInPeriod.filter(i => String(i.processing_status).includes('completed')).length;

    // Example: Get high-value insights (Top 5 by commercial_value_score)
    data.topHighValueInsights = insightsInPeriod
      .sort((a, b) => (parseFloat(b.commercial_value_score) || 0) - (parseFloat(a.commercial_value_score) || 0))
      .slice(0, 5);

    // Example: Get active technology domains (from Technology_Registry, calculate relevant insight count)
    const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);
    data.activeTechDomains = allTechnologies.filter(t => t.monitoring_status && String(t.monitoring_status).toLowerCase() === 'active' && 
                                                      (techAreas.length === 0 || techAreas.includes(t.tech_name))) // Only active and within selected tech areas
                                         .map(t => {
      const relevantInsights = insightsInPeriod.filter(i => i.tech_id === t.tech_id);
      return {
        tech_name: t.tech_name,
        insight_count: relevantInsights.length,
        avg_signal_strength: relevantInsights.length > 0 ?
                                relevantInsights.reduce((sum, i) => sum + (parseFloat(i.signal_strength) || 0), 0) / relevantInsights.length : 0
      };
    }).sort((a, b) => b.insight_count - a.insight_count).slice(0, 5); // Only take top 5

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
      data.aiKeyFindings = rawFindings.split(/\n|;；]+/).map(s => s.trim()).filter(s => s.length > 0); 
    }

    // AI生成行动建议
    if (aiOptions.aiRecommendationsEnabled) {
      const recommendationsPrompt = `针对以下关键发现（${data.aiKeyFindings.join('；')}），请提出3-5条具体的行动建议。`;
      const rawRecommendations = this._callAI(recommendationsPrompt, 'actionable_recommendations');
      // 尝试解析为列表
      data.aiActionableRecommendations = rawRecommendations.split(/\n|;；]+/).map(s => s.trim()).filter(s => s.length > 0);
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
   * Save report content to Google Drive.
   * @param {string} fileName - File name (without path)
   * @param {string} content - Report content
   * @param {string} format - File format (html)
   * @returns {GoogleAppsScript.Drive.File} Saved file object
   */
  _saveReportToDrive: function(fileName, content, format) {
    // ✅ Replaced with your Google Drive report folder ID from Config.gs
    const parentFolderId = CONFIG.DRIVE_FOLDERS.REPORTS_OUTPUT; 
    
    // Check if folder ID is set, or if it's an invalid default placeholder
    if (!parentFolderId || parentFolderId === 'YOUR_REPORT_FOLDER_ID_IN_DRIVE') {
        throw new Error("Google Drive 报告文件夹ID未设置。请在 Config.gs 中配置 'DRIVE_FOLDERS.REPORTS_OUTPUT'。");
    }

    const parentFolder = DriveApp.getFolderById(parentFolderId);
    
    let file;
    if (format === 'html') { // Save as HTML file
      file = parentFolder.createFile(fileName, content, MimeType.HTML);
    } else { // Default to plain text as a fallback
      file = parentFolder.createFile(fileName, content, MimeType.PLAIN_TEXT);
    }
    
    return file;
  },

  /**
   * Generate report file name.
   * @param {string} reportTitle - Report title, used in file name
   * @param {string} outputFormat - File format (html)
   * @returns {string} File name
   */
  _generateReportFileName: function(reportTitle, outputFormat) {
    // Clean special characters from title to ensure valid file name
    const cleanTitle = reportTitle.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5 -]/g, '').trim();
    const timestamp = DateUtils.formatDate(new Date(), true, 'yyyyMMdd_HHmmss'); // Use DateUtils
    return `${cleanTitle}_${timestamp}.${outputFormat}`;
  },

  /**
   * Record report metadata to Reports_History table.
   * @param {object} metadata - Report metadata object
   */
  _recordReportHistory: function(metadata) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB; // TechInsight_Operations_DB
    const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY; 

    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(sheetName);
    if (!sheet) {
      logError(`[ReportsService] Error: Sheet "${sheetName}" not found in DB "${dbId}". Report history not recorded.`);
      return;
    }

    // Ensure data is written in the correct column order
    // Adjust based on the actual column order of Reports_History table
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
   * Update report status in Reports_History table.
   * Used to update email delivery failures etc.
   * @param {string} reportId - Report ID
   * @param {string} newStatus - New status
   */
  _updateReportHistoryStatus: function(reportId, newStatus) {
    const dbId = CONFIG.DATABASE_IDS.OPERATIONS_DB;
    const sheetName = CONFIG.SHEET_NAMES.REPORTS_HISTORY;
    const sheet = SpreadsheetApp.openById(dbId).getSheetByName(sheetName);
    if (!sheet) {
      logError(`[ReportsService] Error: Sheet "${sheetName}" not found for status update.`);
      return;
    }

    const data = sheet.getDataRange().getValues();
    const headers = data[0]; // Assume first row is English headers
    const statusColIndex = headers.indexOf('status');
    const reportIdColIndex = headers.indexOf('report_id');

    if (statusColIndex === -1 || reportIdColIndex === -1) {
      logError(`[ReportsService] Error: 'status' or 'report_id' column not found in ${sheetName}.`);
      return;
    }

    for (let i = 2; i < data.length; i++) { // Start searching from the third row
      if (data[i][reportIdColIndex] === reportId) {
        sheet.getRange(i + 1, statusColIndex + 1).setValue(newStatus);
        logDebug(`[ReportsService] Report ${reportId} status updated to ${newStatus}.`);
        return;
      }
    }
    logWarning(`[ReportsService] Report ${reportId} not found for status update.`);
  },

  /**
   * Get list of report recipients.
   * @param {string} reportType - Report type (Daily, Weekly, Monthly, Annual, Default)
   * @param {string} [additionalRecipientEmail] - Additional recipient email, if provided, appended to the list
   * @returns {Array<string>} List of recipient emails
   */
  _getReportRecipients: function(reportType, additionalRecipientEmail) {
    const recipients = new Set(); // Use Set for uniqueness

    try {
      const dbId = CONFIG.DATABASE_IDS.CONFIG_DB; // Recipient config in Config_DB
      const sheetName = CONFIG.SHEET_NAMES.REPORT_RECIPIENTS; // New recipient sheet name

      const allRecipients = DataService.getDataAsObjects(dbId, sheetName);

      // Add recipients for specific report type and default type
      allRecipients.forEach(record => {
        if (record.is_active && (String(record.is_active).toLowerCase() === 'true' || record.is_active === true)) {
          if (record.report_type === reportType || record.report_type === 'Default') {
            if (record.recipient_email && Utilities.validateEmail(record.recipient_email)) { // Validate email format
              recipients.add(record.recipient_email.toLowerCase());
            }
          }
        }
      });
    } catch (e) {
      logError(`[ReportsService] Error fetching recipients from config: ${e.message}`);
      // If fetching config fails, don't stop, continue with additional email
    }

    // Add additional recipient email (if provided and valid)
    if (additionalRecipientEmail && String(additionalRecipientEmail).trim().length > 0) {
      recipients.add(additionalRecipientEmail.toLowerCase());
    }

    return Array.from(recipients);
  },

  // ✅ Helper function: Call external AI service to generate summary (placeholder)
  // You need to replace the implementation here to call actual AI API (e.g., OpenAI, Gemini)
  // This typically involves UrlFetchApp to send HTTP requests to the AI service API endpoint
  _callAI: function(prompt, purpose) {
    // This is a simulated implementation; you need to replace it with an actual AI API call
    // For example, using UrlFetchApp.fetch()
    logDebug(`[ReportsService] Calling external AI with prompt: ${prompt.substring(0, 100)}...`);
    try {
        // const OPENAI_API_KEY = "sk-proj"; // Store in Apps Script's User Properties for better security
        // const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", {
        //     method: "post",
        //     headers: {
        //         "Authorization": "Bearer " + OPENAI_API_KEY,
        //         "Content-Type": "application/json",
        //     },
        //     payload: JSON.stringify({
        //         model: "gpt-3.5-turbo", // Or other models
        //         messages: [{ role: "user", content: prompt }],
        //         max_tokens: 200,
        //         temperature: 0.7,
        //     }),
        //     muteHttpExceptions: true // Prevent HTTP errors from throwing exceptions directly
        // });
        // const jsonResponse = JSON.parse(response.getContentText());
        // if (response.getResponseCode() === 200) {
        //     return jsonResponse.choices[0].message.content.trim();
        // } else {
        //     logError(`AI API Error: ${response.getResponseCode()} - ${jsonResponse.error.message}`);
        //     return "AI摘要生成失败：API错误。";
        // }
        return "AI智能摘要：本期报告聚焦前沿技术发展，识别出高价值洞察，主要集中在人工智能和智能体领域。建议密切关注智能体互联网和AI驱动威胁检测技术，其商业价值和信号强度均显示出较高潜力。系统整体运行平稳，数据质量良好。"; // Simulate AI summary
    } catch (e) {
        logError(`[ReportsService] _callExternalAIForSummary failed: ${e.message}\n${e.stack}`);
        return "AI摘要生成失败：连接或解析错误。";
    }
  }
};