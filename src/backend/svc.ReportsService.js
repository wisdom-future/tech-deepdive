// 文件名: backend/svc.Reports.gs (最终 Firestore 适配完整版)

const ReportsService = {

  // ====================================================================================================
  //  主函数：生成报告
  // ====================================================================================================

  generateReport: function(reportType, reportTitle, periodStartStr, periodEndStr, techAreas, targetAudience, reportOwner, userReportSummary, additionalRecipientEmail, aiOptions = {}) {
    const ADMIN_EMAIL = Session.getEffectiveUser().getEmail(); 
    const today = new Date();
    const periodStart = new Date(periodStartStr + 'T00:00:00Z');
    const periodEnd = new Date(periodEndStr + 'T23:59:59Z');
    const generatedBy = Session.getActiveUser().getEmail() || 'System_Trigger';
    const reportId = `REPORT_${Utilities.formatDate(today, Session.getScriptTimeZone(), 'yyyyMMddHHmmss')}_${reportType.toUpperCase()}`;

    let reportFolder;
    let htmlFile = null;
    let errorMessage = '';
    let recipientEmails = [];

    try {
        const currentGasUrl = ScriptApp.getService().getUrl();
        Logger.log(`成功获取到currentGasUrl: ${currentGasUrl}`);
        this._updateGitHubRedirect(currentGasUrl);
    } catch (e) {
        Logger.log(`警告：更新 GitHub 重定向 URL 失败: ${e.message}`);
        // 即使更新失败，也继续生成报告，不中断主流程
    }

    try {
        const parentFolderId = '1lLe47xY5MCuQQGlvmnUBwYyiMTt0qql_'; // 请替换为您的Google Drive报告文件夹ID
        reportFolder = DriveApp.getFolderById(parentFolderId);
        Logger.log("成功获取到Google Drive目标文件夹。");
    } catch(driveError) {
        Logger.log(`!!! 致命错误：无法访问Drive文件夹ID '${parentFolderId}'。错误: ${driveError.message}`);
        MailApp.sendEmail(ADMIN_EMAIL, "【严重错误】报告系统无法访问目标Drive文件夹", `错误信息: ${driveError.message}`);
        throw new Error(`无法访问Drive文件夹，报告生成中止。`);
    }

    try {
        Logger.log(`[ReportsService] Generating report '${reportTitle}'...`);
        
        const reportData = this._aggregateReportData(reportType, periodStart, periodEnd, techAreas, userReportSummary, periodStartStr, periodEndStr, reportFolder);
        Logger.log(`[ReportsService] Data aggregated for report.`);

        const reportContentHtml = this._generateReportContentHtml(reportType, reportTitle, periodStartStr, periodEndStr, reportData);
        Logger.log(`[ReportsService] HTML content generated. Length: ${reportContentHtml.length} characters.`);

        const reportFileName = this._generateReportFileName(reportTitle, 'html');
        htmlFile = this._saveReportToDrive(reportFileName, reportContentHtml, 'html', reportFolder);
        
        let mailStatusMessage = "邮件未发送（无收件人）。";
        let finalReportUrl = null; // 新增变量，用于存储最终的查看URL
        let githubReportUrl = null; // 新增变量，用于存储GitHub URL

        if (htmlFile) { // 仅在文件成功保存后才继续，以确保有可用的下载链接
            Logger.log(`[ReportsService] Report HTML file saved to Drive: ${htmlFile.getName()}, ID: ${htmlFile.getId()}, Size: ${htmlFile.getSize()} bytes.`);
            
            // ✅ 在这里插入GitHub发布逻辑
            const githubResult = this._publishReportToGitHub(reportFileName, reportContentHtml);
            if(githubResult.success) {
                Logger.log(`GitHub发布成功，URL: ${githubResult.url}`);
                githubReportUrl = githubResult.url; // 将GitHub Pages URL 存储起来
            } else {
                errorMessage += `警告：报告未能发布到GitHub。原因: ${githubResult.message}<br>`;
            }
            
            if (githubReportUrl) {
                // 优先使用 GitHub Pages URL 作为最终的报告查看链接
                finalReportUrl = githubReportUrl; 
            } else {
                // 如果 GitHub Pages URL 不存在（例如发布失败），则回退到 Google Drive 的直接查看链接
                // 这种链接会尝试让浏览器直接渲染 HTML，而不是进入 Drive 的预览界面
                finalReportUrl = `https://drive.google.com/uc?export=view&id=${htmlFile.getId()}`;
                Logger.log(`GitHub发布失败，使用Google Drive直接查看链接: ${finalReportUrl}`);
            }


            recipientEmails = this._getReportRecipients(reportType, additionalRecipientEmail);
            if (recipientEmails.length > 0) {
                Logger.log(`[ReportsService] Recipient emails: ${recipientEmails.join(', ')}`);
                try {
                    // ✅ 核心修改：直接发送完整HTML，不再使用附件
                    MailApp.sendEmail({
                        to: recipientEmails.join(','),
                        subject: `[技术洞察报告] ${reportTitle}`,
                        name: 'TechInsight AI Engine',
                        htmlBody: reportContentHtml 
                    });
                    mailStatusMessage = "邮件已发送。";
                    Logger.log(`[ReportsService] Report email with full HTML body sent.`);
                } catch(mailError) {
                    Logger.log(`!!! 发送邮件失败。错误: ${mailError.message}`);
                    errorMessage += `警告：发送邮件失败。错误: ${mailError.message}<br>`;
                }
            }
        } else {
            Logger.log("警告: 报告HTML文件未能成功保存到Google Drive，因此邮件也未发送。");
            errorMessage += "警告：报告HTML文件未能保存到Google Drive。<br>";
            finalReportUrl = null; // 确保在文件未保存成功时，URL为null
        }
        
        const reportMetadata = {
            id: reportId, report_id: reportId, report_name: reportTitle, report_type: reportType,
            generation_date: today, report_period_start: periodStart, report_period_end: periodEnd,
            generated_by: generatedBy, 
            drive_file_id: htmlFile ? htmlFile.getId() : null,
            download_url: finalReportUrl, // <<< 关键修改：使用计算出的 finalReportUrl
            status: htmlFile ? 'Generated' : 'Failed',
            recipients: recipientEmails.join(', '),
            error_message: errorMessage,
            created_timestamp: today, updated_timestamp: today
        };
        this._recordReportHistory(reportMetadata);
        Logger.log(`[ReportsService] Report history recorded with status: ${reportMetadata.status}.`);

        return { success: true, message: `报告流程完成。Drive保存: ${htmlFile ? '成功' : '失败'}. ${mailStatusMessage}`, downloadUrl: finalReportUrl }; // <<< 关键修改：返回 finalReportUrl

    } catch (e) {
        Logger.log(`!!! CRITICAL ERROR during report generation main process: ${e.message}\n${e.stack}`);
        try {
            MailApp.sendEmail(ADMIN_EMAIL, `【严重错误】技术洞察报告生成失败 - ${reportTitle}`, `错误详情: ${e.message}\n\n${e.stack}`);
        } catch (mailError) {
            Logger.log(`!!! FAILED TO SEND ERROR NOTIFICATION EMAIL: ${mailError.message}`);
        }
        this._recordReportHistory({
            id: reportId, report_id: reportId, report_name: reportTitle, report_type: reportType,
            generation_date: today, status: 'Failed', error_message: e.message,
            created_timestamp: today, updated_timestamp: today
        });
        throw new Error(`报告生成过程中发生致命错误: ${e.message}`);
    }
},

  // ====================================================================================================
  // ✅ 数据聚合函数 (最终版 - 纯数据宏观洞察，无省略)
  // ====================================================================================================
  _aggregateReportData: function(reportType, periodStart, periodEnd, techAreas, userReportSummary, periodStartStr, periodEndStr, reportFolder) {
    // 1. 初始化最终返回的数据结构
    const data = {
        benchmarks: [],
        techDomains: [],
        stats: { newInsightsCount: 0, newRawDataCount: 0, competitorNewsCount: 0 },
        topTrends: [],      // 用于存放Top趋势
        topRelations: [],   // 用于存放Top关系
        aiSummary: "AI正在分析本周期概要...",
        aiKeyFindings: [],
        aiRecommendations: []
        // 注意：chartUrl 和 knowledgeGraphUrl 已被移除，因为我们不再生成图片
    };

    try {
        Logger.log("开始聚合报告数据 (纯数据洞察版)...");

        // --- 2. 一次性获取所有周期内的数据 ---
        const inPeriod = (item) => {
            const dateValue = item.publication_date || item.last_commit_date || item.application_date || item.created_timestamp;
            if (!dateValue) return false;
            const date = new Date(dateValue);
            return !isNaN(date.getTime()) && date >= periodStart && date <= periodEnd;
        };

        const rawDataSources = {
            techNews: DataService.getDataAsObjects('RAW_TECH_NEWS').filter(inPeriod),
            academicPapers: DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS').filter(inPeriod),
            patentData: DataService.getDataAsObjects('RAW_PATENT_DATA').filter(inPeriod),
            openSourceData: DataService.getDataAsObjects('RAW_OPENSOURCE_DATA').filter(inPeriod),
            competitorIntelligence: DataService.getDataAsObjects('RAW_COMPETITOR_INTELLIGENCE').filter(inPeriod)
        };
        const insightsInPeriod = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER').filter(inPeriod);
        Logger.log("周期内原始数据筛选完成。");

        // --- 3. 按“业界标杆”聚合动态 ---
        const activeBenchmarks = DataService.getDataAsObjects('COMPETITOR_REGISTRY').filter(b => b.monitoring_status === 'active');
        data.benchmarks = activeBenchmarks.map(benchmark => {
            let updates = [];
            (rawDataSources.competitorIntelligence || []).forEach(item => {
                if (item.competitor_name === benchmark.company_name) {
                    updates.push({
                        title: item.intelligence_title,
                        summary: this._getChineseSummary(item.intelligence_title, item.intelligence_summary || item.ai_summary),
                        source_url: item.source_url,
                        type: item.intelligence_type || '关键动态',
                        source_platform: item.source_platform,
                        date: new Date(item.publication_date || item.created_timestamp)
                    });
                }
            });
            updates.sort((a, b) => b.date - a.date);
            return { company_name: benchmark.company_name, updates: updates.slice(0, 3) }; // 每个标杆Top 3
        }).filter(b => b.updates.length > 0);
        Logger.log(`聚合了 ${data.benchmarks.length} 个有动态的业界标杆。`);

        // --- 4. 按“技术领域”聚合进展 ---
        const activeTechs = DataService.getDataAsObjects('TECH_REGISTRY').filter(t => t.monitoring_status === 'active');
        data.techDomains = activeTechs.map(tech => {
            let rawUpdatesText = "";
            const techKeywords = (tech.tech_keywords || '').toLowerCase().split(',').map(k => k.trim()).filter(Boolean);
            const hasKeyword = (text) => text && techKeywords.some(kw => text.toLowerCase().includes(kw));

            (rawDataSources.academicPapers || []).filter(item => hasKeyword(item.title + item.abstract)).forEach(item => rawUpdatesText += `[学术论文] ${item.title}: ${item.abstract}\n`);
            (rawDataSources.patentData || []).filter(item => hasKeyword(item.title + item.abstract)).forEach(item => rawUpdatesText += `[技术专利] ${item.title}: ${item.abstract}\n`);
            (rawDataSources.openSourceData || []).filter(item => hasKeyword(item.project_name + item.description)).forEach(item => rawUpdatesText += `[开源项目] ${item.project_name}: ${item.description}\n`);
            (rawDataSources.techNews || []).filter(item => hasKeyword(item.news_title + item.news_summary)).forEach(item => rawUpdatesText += `[技术新闻] ${item.news_title}: ${item.news_summary}\n`);

            let summarizedUpdates = [];
            if (rawUpdatesText.trim() !== "") {
                const summaryPrompt = `你是一名资深技术分析师。请阅读以下关于“${tech.tech_name}”领域的所有原始信息。你的任务是：1. 理解所有信息，识别出相似或重复的内容。2. 将内容归纳为不超过3个核心主题。3. 为每个核心主题，生成一条精炼的、不超过100字的中文摘要。4. 为每个摘要，从原始信息中找到最相关的一个源链接。5. 严格按照指定的JSON格式返回结果，不要包含任何其他文字。\n\n原始信息如下：\n---\n${rawUpdatesText.substring(0, 15000)}\n---\n\n请以JSON数组格式返回，每个对象包含"topic", "summary", 和 "source_url"三个键：\n[{"topic": "第一个核心主题的中文标题", "summary": "关于这个主题的、不超过100字的中文摘要。", "source_url": "http://..."}, ...]`;
                try {
                    const aiResultJsonString = this._callAIForTextGeneration(summaryPrompt, { model: 'gpt-4o', max_tokens: 1500, temperature: 0.3 });
                    const cleanedJsonString = aiResultJsonString.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsedResult = JSON.parse(cleanedJsonString);
                    if (Array.isArray(parsedResult)) {
                        summarizedUpdates = parsedResult.map(item => ({
                            title: item.topic,
                            summary: item.summary,
                            source_url: item.source_url || '#',
                            type: 'AI聚合摘要',
                            source_platform: '多源'
                        }));
                    }
                } catch (e) {
                    Logger.log(`为技术领域“${tech.tech_name}”生成AI摘要失败: ${e.message}`);
                }
            }
            return { tech_name: tech.tech_name, updates: summarizedUpdates };
        }).filter(t => t.updates.length > 0);
        Logger.log(`聚合了 ${data.techDomains.length} 个有进展的技术领域。`);
        
        // --- 5. 计算宏观洞察数据 ---
        data.stats = {
            newInsightsCount: insightsInPeriod.length,
            newRawDataCount: Object.values(rawDataSources).reduce((sum, arr) => sum + (arr ? arr.length : 0), 0),
            competitorNewsCount: (rawDataSources.competitorIntelligence || []).length
        };
        
        const keywordCounts = new Map();
        insightsInPeriod.forEach(insight => {
            if (insight.tech_keywords) {
                String(insight.tech_keywords).split(',').map(k => k.trim()).filter(Boolean).forEach(keyword => {
                    keywordCounts.set(keyword, (keywordCounts.get(keyword) || 0) + 1);
                });
            }
        });
        data.topTrends = Array.from(keywordCounts.entries())
            .map(([name, value]) => ({ name, value }))
            .sort((a, b) => b.value - a.value)
            .slice(0, 5);
        Logger.log(`计算出Top趋势: ${data.topTrends.length}条`);

        const graphData = InsightsService.getKnowledgeGraphData(); // 假设 InsightsService.getKnowledgeGraphData 可用
        if (graphData && graphData.edges && graphData.edges.length > 0) {
            const nodesMap = new Map(graphData.nodes.map(n => [n.id, n]));
            data.topRelations = graphData.edges
                .sort((a, b) => b.value - a.value)
                .slice(0, 5)
                .map(edge => ({
                    source: nodesMap.get(edge.source)?.name || edge.source,
                    target: nodesMap.get(edge.target)?.name || edge.target,
                    value: edge.value
                }));
            Logger.log(`计算出核心关系: ${data.topRelations.length}条`);
        }
        
        // --- 6. 全局AI摘要生成 ---
        let globalAiPromptContext = `你是一名顶级的行业与技术战略分析师，请根据以下在 ${periodStartStr} 到 ${periodEndStr} 期间收集并由AI预处理的情报，用中文生成一份专业的分析报告摘要。\n\n### 业界标杆动态摘要\n`;
        data.benchmarks.forEach(b => {
            globalAiPromptContext += `关于 ${b.company_name}:\n`;
            b.updates.forEach(u => { globalAiPromptContext += `- ${u.type}: ${u.title}\n`; });
        });
        globalAiPromptContext += "\n### 关键技术领域进展摘要\n";
        data.techDomains.forEach(t => {
            globalAiPromptContext += `关于 ${t.tech_name}:\n`;
            t.updates.forEach(u => { globalAiPromptContext += `- ${u.topic}: ${u.summary}\n`; });
        });
        globalAiPromptContext += "\n请基于以上所有信息，完成以下任务，并严格以JSON格式返回，确保所有返回的文本都是中文：\n";
        globalAiPromptContext += `{"summary": "请用一段话（约100-150字）总结本周期的整体技术和市场动态。","key_findings": ["提炼出的第一个最核心的中文发现","提炼出的第二个最核心的中文发现","提炼出的第三个最核心的中文发现（可选）"],"recommendations": "综合所有信息，提出1-2条具体的、可执行的中文战略或战术建议。","trending_keywords": ["热度上升最快的第一个中文关键词","本周期新出现的第二个重要关键词","第三个值得关注的中文关键词"]}`;
        
        const globalAiResultJsonString = this._callAIForTextGeneration(globalAiPromptContext, { model: 'gpt-4o', max_tokens: 1500 });
        
        try {
            const cleanedJsonString = globalAiResultJsonString.replace(/```json/g, '').replace(/```/g, '').trim();
            const aiResult = JSON.parse(cleanedJsonString);
            data.aiSummary = aiResult.summary || "未能生成概要。";
            data.aiKeyFindings = aiResult.key_findings || ["未能提取关键发现。"];
            data.aiRecommendations = aiResult.recommendations || "未能生成建议。";
            data.trendingKeywords = aiResult.trending_keywords || [];
            Logger.log("AI摘要、发现和建议生成成功。");
        } catch (e) {
            Logger.log(`AI返回的JSON解析失败: ${e.message}. 原始字符串: ${globalAiResultJsonString}`);
            data.aiSummary = "AI响应格式错误，无法解析。"; data.aiKeyFindings = ["AI响应格式错误。"]; data.aiRecommendations = "AI响应格式错误。"; data.trendingKeywords = [];
        }

    } catch (e) {
        Logger.log(`报告数据聚合失败: ${e.message}\n${e.stack}`);
        data.aiSummary = `数据聚合过程中发生错误: ${e.message}`;
    }
    return data;
},


  _getChineseSummary: function(title, originalSummary) {
    if (!originalSummary) return "（无摘要信息）";
    if (/^[\u4e00-\u9fa5]/.test(originalSummary) && originalSummary.length < 150) {
        return originalSummary;
    }
    try {
        const prompt = `请将以下英文信息精炼并翻译成一段流畅的、不超过100字的中文摘要。请直接返回摘要内容，不要添加任何额外的标题或解释。\n\n标题: "${title}"\n\n内容: "${originalSummary}"`;
        const summary = this._callAIForTextGeneration(prompt, { model: 'gpt-4o-mini', max_tokens: 300, temperature: 0.2 });
        return summary.includes("AI生成失败") ? originalSummary.substring(0, 100) + '...' : summary;
    } catch (e) {
        Logger.log(`生成中文摘要失败: ${e.message}`);
        return originalSummary.substring(0, 100) + '...';
    }
  },
  
  _generateReportContentHtml: function(reportType, reportTitle, periodStartStr, periodEndStr, reportData) {
    const template = HtmlService.createTemplateFromFile('frontend/templates/ReportTemplate'); // 假设 ReportTemplate.html 存在
    template.reportTitle = reportTitle;
    template.periodStartStr = periodStartStr;
    template.periodEndStr = periodEndStr;
    template.reportData = reportData;
    return template.evaluate().getContent();
  },

  _saveReportToDrive: function(fileName, content, format, reportFolder) {
    if (!reportFolder) {
        Logger.log("警告: 未能提供有效的Drive文件夹对象，跳过保存。");
        return null;
    }
    try {
        const uniqueFileName = `${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMdd_HHmmss')}_${fileName}`;
        const blob = Utilities.newBlob(content, MimeType.HTML, uniqueFileName);
        return reportFolder.createFile(blob);
    } catch (e) {
        Logger.log(`!!! DriveApp.createFile 失败。文件夹: '${reportFolder.getName()}'. 错误: ${e.message}`);
        return null;
    }
  },
  
  _publishReportToGitHub: function(fileName, content) {
    const scriptProps = PropertiesService.getScriptProperties();
    const GITHUB_TOKEN = scriptProps.getProperty('GITHUB_TOKEN');
    const GITHUB_OWNER = scriptProps.getProperty('GITHUB_OWNER');
    const GITHUB_REPO = scriptProps.getProperty('GITHUB_REPO');
    const GITHUB_BRANCH = 'main'; // 或者 'master'，取决于你的主分支名称

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        Logger.log("警告：GitHub发布配置不完整，跳过此步骤。");
        return { success: false, message: "GitHub配置不完整" };
    }

    // --- 内部辅助函数：用于执行GitHub API的PUT请求 ---
    const putFileToGithub = (path, base64Content, commitMessage) => {
        const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${path}`;
        const headers = {
            "Authorization": `token ${GITHUB_TOKEN}`,
            "Accept": "application/vnd.github.v3+json"
        };
        
        // 1. 检查文件是否存在以获取SHA
        let sha = null;
        const checkResponse = UrlFetchApp.fetch(apiUrl, { headers: headers, muteHttpExceptions: true });
        if (checkResponse.getResponseCode() === 200) {
            sha = JSON.parse(checkResponse.getContentText()).sha;
        }

        // 2. 准备payload
        const payload = {
            message: commitMessage,
            content: base64Content,
            sha: sha,
            branch: GITHUB_BRANCH
        };

        // 3. 发送PUT请求
        const options = {
            method: 'put',
            headers: headers,
            payload: JSON.stringify(payload),
            muteHttpExceptions: true
        };
        
        const putResponse = UrlFetchApp.fetch(apiUrl, options);
        return {
            responseCode: putResponse.getResponseCode(),
            result: JSON.parse(putResponse.getContentText())
        };
    };

    try {
        // --- 步骤 1: 上传报告HTML文件 ---
        const reportPath = `reports/${fileName}`;
        const reportContentBase64 = Utilities.base64Encode(content, Utilities.Charset.UTF_8);
        const reportCommitMessage = `自动发布报告: ${fileName}`;
        
        const reportUploadResponse = putFileToGithub(reportPath, reportContentBase64, reportCommitMessage);

        if (reportUploadResponse.responseCode !== 201 && reportUploadResponse.responseCode !== 200) {
            Logger.log(`GitHub报告上传失败: ${JSON.stringify(reportUploadResponse.result)}`);
            return { success: false, message: "GitHub报告上传失败" };
        }
        
        // ✅ 核心修改：构建GitHub Pages的URL，而不是raw URL
        const reportPagesUrl = `https://${GITHUB_OWNER}.github.io/${GITHUB_REPO}/${reportPath}`;
        Logger.log(`成功上传报告到GitHub，Pages URL: ${reportPagesUrl}`);

        // --- 更新 latest.json 文件 ---
        const indexPath = 'reports/latest.json';
        const latestJsonContent = JSON.stringify({
            latestReportUrl: reportPagesUrl, // ✅ 使用新的Pages URL
            lastUpdated: new Date().toISOString()
        }, null, 2);
        
        const latestJsonContentBase64 = Utilities.base64Encode(latestJsonContent, Utilities.Charset.UTF_8);
        const latestJsonCommitMessage = `更新 latest.json 指向: ${fileName}`;
        
        const latestJsonResponse = putFileToGithub('reports/latest.json', latestJsonContentBase64, latestJsonCommitMessage);

        if (latestJsonResponse.responseCode !== 201 && latestJsonResponse.responseCode !== 200) {
            Logger.log(`更新 latest.json 失败: ${JSON.stringify(latestJsonResponse.result)}`);
            // 即使索引更新失败，报告本身上传成功了，所以我们仍然可以认为部分成功
            return { success: true, url: reportPagesUrl, message: "报告上传成功，但索引文件更新失败" }; // 返回 Pages URL
        }
        
        Logger.log("成功更新 latest.json 索引文件。");
        return { success: true, url: reportPagesUrl, message: "发布成功" }; // 返回 Pages URL

    } catch (e) {
        Logger.log(`与GitHub API交互时发生严重错误: ${e.message}`);
        return { success: false, message: `与GitHub API交互时发生严重错误: ${e.message}` };
    }
  },

_updateGitHubRedirect: function(gasUrl) {
    const scriptProps = PropertiesService.getScriptProperties();
    const GITHUB_TOKEN = scriptProps.getProperty('GITHUB_TOKEN');
    const GITHUB_OWNER = scriptProps.getProperty('GITHUB_OWNER');
    const GITHUB_REPO = scriptProps.getProperty('GITHUB_REPO');
    const GITHUB_BRANCH = 'main';

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
        Logger.log("警告：GitHub 配置不完整，无法更新重定向 URL。");
        return { success: false, message: "GitHub配置不完整" };
    }

    const filePath = 'index.html';
    const apiUrl = `https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/${filePath}`;
    const headers = {
        "Authorization": `token ${GITHUB_TOKEN}`,
        "Accept": "application/vnd.github.v3+json"
    };

    // 1. 获取现有文件的 SHA
    let sha = null;
    try {
        const checkResponse = UrlFetchApp.fetch(apiUrl, { headers: headers, muteHttpExceptions: true });
        if (checkResponse.getResponseCode() === 200) {
            sha = JSON.parse(checkResponse.getContentText()).sha;
        } else if (checkResponse.getResponseCode() !== 404) {
            // 如果不是 "Not Found" 错误，则说明有问题
            throw new Error(`获取 index.html 的 SHA 失败: ${checkResponse.getContentText()}`);
        }
    } catch (e) {
        Logger.log(`获取 GitHub 文件 SHA 失败: ${e.message}`);
        return { success: false, message: `获取 GitHub 文件 SHA 失败: ${e.message}` };
    }

    // 2. 创建新的文件内容
    const newContent = `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <title>Redirecting to Deepdive Engine...</title>
        <meta http-equiv="refresh" content="0; url=${gasUrl}">
    </head>
    <body>
        <p>Redirecting... If you are not redirected automatically, please <a href="${gasUrl}">click here</a>.</p>
        <script>window.location.href = "${gasUrl}";</script>
    </body>
    </html>`;

    // 3. 准备 Payload 并发送 PUT 请求
    const payload = {
        message: `[Automated] Update GAS redirect URL to ${gasUrl.slice(-10)}`,
        content: Utilities.base64Encode(newContent, Utilities.Charset.UTF_8),
        sha: sha, // 提供 sha 来更新文件
        branch: GITHUB_BRANCH
    };

    const options = {
        method: 'put',
        headers: headers,
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
    };

    const putResponse = UrlFetchApp.fetch(apiUrl, options);
    const responseCode = putResponse.getResponseCode();

    if (responseCode === 200 || responseCode === 201) {
        Logger.log(`成功更新 GitHub 上的 index.html，使其指向: ${gasUrl}`);
        return { success: true };
    } else {
        const errorResult = putResponse.getContentText();
        Logger.log(`更新 GitHub 上的 index.html 失败。状态码: ${responseCode}, 响应: ${errorResult}`);
        return { success: false, message: `更新 GitHub 失败: ${errorResult}` };
    }
},

// ====================================================================================================
//  ✅ 图表生成函数 (最终版 - 增加延时与重试)
// ====================================================================================================
_generateChartImage: function(chartConfig, fileName) {
    const scriptProps = PropertiesService.getScriptProperties();
    const cloudName = scriptProps.getProperty('CLOUDINARY_CLOUD_NAME');
    const apiKey = scriptProps.getProperty('CLOUDINARY_API_KEY');
    const apiSecret = scriptProps.getProperty('CLOUDINARY_API_SECRET');

    if (!cloudName || !apiKey || !apiSecret) {
        Logger.log("错误：未在脚本属性中完整配置Cloudinary凭证。");
        return null;
    }

    // ✅ 增加重试逻辑
    const maxRetries = 3;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            Logger.log(`开始生成图表 '${fileName}' (尝试第 ${attempt} 次)...`);

            const qcUrl = 'https://quickchart.io/chart';
            const qcPayload = { backgroundColor: '#ffffff', width: 720, height: 400, chart: chartConfig };
            
            // ✅ 增加UrlFetchApp的超时设置
            const qcOptions = {
                method: 'post',
                contentType: 'application/json',
                payload: JSON.stringify(qcPayload),
                muteHttpExceptions: true,
                deadline: 30 // 设置30秒的超时时间
            };
            const qcResponse = UrlFetchApp.fetch(qcUrl, qcOptions);

            if (qcResponse.getResponseCode() !== 200) {
                Logger.log(`QuickChart API 错误 (尝试 ${attempt}): ${qcResponse.getResponseCode()} - ${qcResponse.getContentText()}`);
                if (attempt < maxRetries) Utilities.sleep(2000); // 如果失败，等待2秒后重试
                continue; // 继续下一次尝试
            }
            const imageBase64 = Utilities.base64Encode(qcResponse.getBlob().getBytes());
            const fileDataUri = `data:image/png;base64,${imageBase64}`;


            const timestamp = String(Math.round(new Date().getTime() / 1000));
            const folder = 'deepdive_reports';
            const publicId = `${fileName.replace('.png', '')}_${timestamp}`;
            
            const paramsToSign = { timestamp, folder, public_id: publicId };
            const signature = this._generateCloudinarySignature(paramsToSign, apiSecret);
            
            const cloudinaryPayload = { file: fileDataUri, api_key: apiKey, timestamp, signature, folder, public_id: publicId };
            const uploadUrl = `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`;
            const uploadOptions = { method: 'post', payload: cloudinaryPayload, muteHttpExceptions: true, deadline: 30 };

            const uploadResponse = UrlFetchApp.fetch(uploadUrl, uploadOptions);
            const uploadResult = JSON.parse(uploadResponse.getContentText());

            if (uploadResponse.getResponseCode() === 200 && uploadResult.secure_url) {
                const imageUrl = uploadResult.secure_url;
                Logger.log(`成功上传图表到 Cloudinary: ${imageUrl}`);
                return imageUrl; // ✅ 成功！立即返回URL并退出循环
            } else {
                Logger.log(`Cloudinary 上传失败 (尝试 ${attempt}): ${uploadResponse.getContentText()}`);
                if (attempt < maxRetries) Utilities.sleep(2000); // 失败后等待
            }

        } catch (e) {
            Logger.log(`在 _generateChartImage (尝试 ${attempt}) 中发生严重错误: ${e.message}`);
            if (attempt < maxRetries) Utilities.sleep(2000); // 异常后等待
        }
    }

    // 如果所有尝试都失败了
    Logger.log(`!!! 生成图表 '${fileName}' 在 ${maxRetries} 次尝试后彻底失败。`);
    return null;
},

  _generateCloudinarySignature: function(paramsToSign, apiSecret) {
    const sortedKeys = Object.keys(paramsToSign).sort();
    const stringToSign = sortedKeys.map(key => `${key}=${paramsToSign[key]}`).join('&');
    const finalStringToSign = stringToSign + apiSecret;
    const signatureBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_1, finalStringToSign);
    return signatureBytes.map(byte => {
        const v = (byte < 0 ? byte + 256 : byte).toString(16);
        return v.length === 1 ? '0' + v : v;
    }).join('');
  },

  _callAIForTextGeneration: function(prompt, options = {}) {
    Logger.log(`[AI-TextGen] Calling AI. Prompt snippet: ${prompt.substring(0, 100)}...`);
    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
        Logger.log("错误：未在脚本属性中配置OPENAI_API_KEY。");
        return `{"error": "AI API Key未配置"}`;
    }
    const model = options.model || "gpt-4o-mini";
    const temperature = options.temperature || 0.5;
    const max_tokens = options.max_tokens || 1024;
    const payload = { model, messages: [{ role: "user", content: prompt }], max_tokens, temperature };
    const requestOptions = { method: "post", contentType: "application/json", headers: { "Authorization": "Bearer " + OPENAI_API_KEY }, payload: JSON.stringify(payload), muteHttpExceptions: true };
    try {
        const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions);
        const jsonResponse = JSON.parse(response.getContentText());
        if (response.getResponseCode() === 200 && jsonResponse.choices && jsonResponse.choices.length > 0) {
            return jsonResponse.choices[0].message.content.trim();
        } else {
            Logger.log(`[AI-TextGen] API Error: ${response.getResponseCode()} - ${JSON.stringify(jsonResponse)}`);
            return `{"error": "AI生成失败：API错误 (${response.getResponseCode()})"}`;
        }
    } catch (e) {
        Logger.log(`[AI-TextGen] API调用失败: ${e.message}\n${e.stack}`);
        return `{"error": "AI生成失败：连接或解析错误 (${e.message})"}`;
    }
  },

  _getKnowledgeGraphConfig: function(graphData) {
    return {
        series: [{
            type: 'graph', layout: 'force', animation: false, roam: false, draggable: false,
            force: { repulsion: 100, edgeLength: 30, gravity: 0.1 },
            label: { show: true, position: 'right', formatter: '{b}', fontSize: 10, color: '#333' },
            categories: [ { name: '技术领域', itemStyle: { color: '#007bff' } }, { name: '竞争对手', itemStyle: { color: '#dc3545' } }, { name: '关键词', itemStyle: { color: '#ffc107' } } ],
            data: graphData.nodes.map(node => ({ ...node, symbolSize: 10 + (node.value || 1) * 2, label: { show: (node.value || 1) > 2 } })),
            links: graphData.edges
        }]
    };
  },

  _prepareTrendChartData: function(insights, startDate, endDate) {
    const dailyCounts = {};
    const labels = [];
    let currentDate = new Date(startDate);
    while (currentDate <= endDate) {
        const dateString = Utilities.formatDate(currentDate, Session.getScriptTimeZone(), 'MM-dd');
        labels.push(dateString);
        dailyCounts[dateString] = 0;
        currentDate.setDate(currentDate.getDate() + 1);
    }
    insights.forEach(insight => {
        const insightDate = new Date(insight.created_timestamp);
        const dateString = Utilities.formatDate(insightDate, Session.getScriptTimeZone(), 'MM-dd');
        if (dailyCounts.hasOwnProperty(dateString)) {
            dailyCounts[dateString]++;
        }
    });
    return { labels, values: labels.map(label => dailyCounts[label]) };
  },

  _getTrendChartConfig: function(labels, values) {
    return {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: '每日新增线索', data: values,
                backgroundColor: 'rgba(0, 123, 255, 0.1)', borderColor: 'rgba(0, 123, 255, 1)',
                borderWidth: 2, pointRadius: 3, pointBackgroundColor: 'rgba(0, 123, 255, 1)',
                fill: true, tension: 0.3
            }]
        },
        options: {
            title: { display: true, text: '高价值线索日增趋势', font: { size: 18, family: 'sans-serif' }, padding: { top: 10, bottom: 20 } },
            legend: { display: false },
            scales: { y: { beginAtZero: true, ticks: { precision: 0 } }, x: { grid: { display: false } } }
        }
    };
  },

  _generateReportFileName: function(reportTitle, outputFormat) {
    const cleanTitle = reportTitle.replace(/[^a-zA-Z0-9_\u4e00-\u9fa5 -]/g, '').trim();
    const timestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyyMMdd_HHmmss');
    return `${cleanTitle}_${timestamp}.${outputFormat}`;
  },

  _recordReportHistory: function(metadata) {
    DataService.batchUpsert('REPORTS_HISTORY', [metadata], 'id');
  },

  _getReportRecipients: function(reportType, additionalRecipientEmail) {
    const recipients = new Set();
    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    try {
        const allRecipients = DataService.getDataAsObjects('REPORT_RECIPIENTS');
        allRecipients.forEach(record => {
            if (String(record.is_active).toLowerCase() === 'true' && (record.report_type === reportType || record.report_type === 'Default')) {
                if (record.recipient_email && emailRegex.test(record.recipient_email)) {
                    recipients.add(record.recipient_email.toLowerCase());
                }
            }
        });
    } catch (e) {
        Logger.log(`[ReportsService] Error fetching recipients from config: ${e.message}`);
    }
    if (additionalRecipientEmail) {
        additionalRecipientEmail.split(',').forEach(email => {
            const trimmedEmail = email.trim();
            if(emailRegex.test(trimmedEmail)) {
                recipients.add(trimmedEmail.toLowerCase());
            }
        });
    }
    return Array.from(recipients);
  },
  
  getReportsHistory: function(page = 1, limit = 15) {
    try {
      const allHistory = DataService.getDataAsObjects('REPORTS_HISTORY');
      if (!allHistory) return { records: [], totalRecords: 0 };
      allHistory.sort((a, b) => (new Date(b.generation_date) || 0) - (new Date(a.generation_date) || 0));
      const totalRecords = allHistory.length;
      const startIndex = (page - 1) * limit;
      const recordsOnPage = allHistory.slice(startIndex, startIndex + limit).map(record => {
        if (record && typeof record === 'object') {
            record.generation_date = this._formatDate(record.generation_date, true);
            record.report_period_start = this._formatDate(record.report_period_start);
            record.report_period_end = this._formatDate(record.report_period_end);
            return record;
        }
        return null;
      }).filter(Boolean);
      return { records: recordsOnPage, totalRecords: totalRecords };
    } catch (e) {
      throw new Error(`Failed to retrieve reports history: ${e.message}`);
    }
  },

  getAllActiveTechNames: function() {
    try {
      const allTechnologies = DataService.getDataAsObjects('TECH_REGISTRY');
      return allTechnologies
        .filter(t => t.monitoring_status && String(t.monitoring_status).toLowerCase() === 'active')
        .map(t => t.tech_name);
    } catch (e) {
      throw new Error(`Failed to retrieve active technology names: ${e.message}`);
    }
  },

  getTechAreasWithInsightsInPeriod: function(periodStartStr, periodEndStr) {
    try {
      const periodStart = new Date(periodStartStr + 'T00:00:00Z');
      const periodEnd = new Date(periodEndStr + 'T23:59:59Z');
      const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER');
      const allTechnologies = DataService.getDataAsObjects('TECH_REGISTRY');
      const techIdsWithInsights = new Set(
        allInsights
          .filter(insight => {
            const insightDate = new Date(insight.created_timestamp);
            return !isNaN(insightDate.getTime()) && insightDate >= periodStart && insightDate <= periodEnd;
          })
          .map(insight => insight.tech_id)
          .filter(Boolean)
      );
      return allTechnologies
        .filter(tech => String(tech.monitoring_status).toLowerCase() === 'active' && techIdsWithInsights.has(tech.tech_id))
        .map(tech => tech.tech_name);
    } catch (e) {
      throw new Error(`Failed to retrieve tech areas with insights: ${e.message}`);
    }
  },

  getScheduledReportsStatus: function() {
    try {
      const configs = DataService.getDataAsObjects('SCHEDULED_REPORTS_CONFIG');
      if (!configs || configs.length === 0) return [];
      return configs
        .filter(c => String(c.is_active).toLowerCase() === 'true')
        .map(c => ({
            job_id: c.job_id,
            report_type: c.report_type,
            report_title_template: c.report_title_template,
            last_run_timestamp: this._formatDate(c.last_run_timestamp, true),
            last_run_status: c.last_run_status,
            description: c.description
        }));
    } catch (e) {
      throw new Error(`Failed to retrieve scheduled reports status: ${e.message}`);
    }
  },

  _formatDate: function(dateValue, includeTime = false) {
    if (!dateValue) return 'N/A';
    let dateObj = (dateValue instanceof Date) ? dateValue : new Date(dateValue);
    if (isNaN(dateObj.getTime())) return String(dateValue);
    const format = includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd';
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
  }
};


// ====================================================================================================
//  ✅ 用于手动测试报告生成的入口函数
// ====================================================================================================
function runManualReportTest() {
  try {
    Logger.log("--- 开始手动触发报告生成测试 ---");
    
    // --- 预设参数 ---
    const reportType = 'Weekly'; // 你想测试的报告类型
    const reportTitle = '【测试】本周技术洞察周报';
    
    // 设置一个过去7天的时间范围
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(endDate.getDate() - 7);
    
    const formatToYYYYMMDD = (date) => Utilities.formatDate(date, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    const periodStartStr = formatToYYYYMMDD(startDate);
    const periodEndStr = formatToYYYYMMDD(endDate);

    const techAreas = []; // 留空以包含所有技术领域
    const targetAudience = '测试团队';
    const reportOwner = '测试工程师';
    const userReportSummary = '这是一份通过手动执行生成的测试报告，用于验证自动化图表功能。';
    
    // ✅ 将你的邮箱地址填在这里，以便接收测试报告
    const recipientEmail = 'hello.duan@foxmail.com'; // <--- ！！重要：请替换成你的邮箱地址 ！！

    // --- 调用主函数 ---
    const result = ReportsService.generateReport(
      reportType,
      reportTitle,
      periodStartStr,
      periodEndStr,
      techAreas,
      targetAudience,
      reportOwner,
      userReportSummary,
      recipientEmail
    );

    Logger.log(`--- 测试完成 ---`);
    Logger.log(`结果: ${result.success}`);
    Logger.log(`消息: ${result.message}`);
    if(result.downloadUrl) {
      Logger.log(`报告下载链接: ${result.downloadUrl}`);
    }

  } catch (e) {
    Logger.log(`!!! 手动测试执行失败: ${e.message}\n${e.stack}`);
  }
}


