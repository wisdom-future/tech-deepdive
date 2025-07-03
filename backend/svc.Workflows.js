// 文件名: backend/svc.Workflows.gs

/**
 * @file 工作流执行服务
 * 负责将原Make.com中的工作流逻辑转换为Apps Script函数，供前端页面调用。
 * 版本：2.0 - 实现所有六层工作流的后端逻辑。
 */
const WorkflowsService = {

  // =========================================================================
  //  辅助函数 (HELPER FUNCTIONS)
  // =========================================================================

  /**
   * 将 MD5 字节数组转换为十六进制字符串
   */
  _bytesToHex: function(hashBytes) {
    let hexString = '';
    for (let i = 0; i < hashBytes.length; i++) {
      let byte = hashBytes[i];
      if (byte < 0) byte += 256;
      const hex = byte.toString(16);
      hexString += (hex.length === 1 ? '0' : '') + hex;
    }
    return hexString;
  },

  /**
   * 记录工作流执行日志
   */
  _logExecution: function(wfName, executionId, startTime, status, processedCount, successCount, errorCount, message) {
    try {
      const endTime = new Date();
      const duration = (endTime.getTime() - startTime.getTime()) / 1000;

      const logObject = {
        id: executionId, // 使用 executionId 作为 Firestore 文档的主键
        execution_id: executionId,
        workflow_name: wfName,
        version: '2.0', // 版本号
        execution_status: status,
        start_timestamp: startTime,
        end_timestamp: endTime,
        duration_seconds: duration,
        items_processed: processedCount,
        items_succeeded: successCount,
        items_failed: errorCount,
        items_skipped: 0, // 默认跳过为0
        trigger_source: 'manual', // 假设为手动触发
        trigger_type: 'on-demand', // 触发类型
        operator_id: Session.getActiveUser().getEmail() || 'system', // ✅ 正确的 operator_id
        summary_message: message, // ✅ 正确的 summary_message
        error_details: status === 'failed' ? message : '', // ✅ 只有失败时才记录错误详情
        run_by: 'system' // 执行者
        // created_timestamp 会由 Firestore 自动生成，无需手动添加
      };
      
      // 使用 batchUpsert 确保日志可以被创建或更新
      DataService.batchUpsert('WORKFLOW_LOG', [logObject], 'id');

    } catch (e) {
      Logger.log(`Failed to write execution log for ${wfName}: ${e.message}`);
    }
  },
  
    /**
   * ✅ 新增：统一的AI评分调用函数
   * @param {string} prompt - 发送给AI的完整指令。
   * @param {object} logContext - 用于日志记录的上下文信息 {wfName, executionId}。
   * @returns {object|null} 解析后的JSON评分对象，或在失败时返回null。
   */
  _callAIForScoring: function(prompt, logContext) {
    const { wfName, executionId } = logContext;
    try {
      const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
      if (!OPENAI_API_KEY) throw new Error("AI API Key未在项目属性中配置 (OPENAI_API_KEY)。");

      const payload = {
        model: "gpt-4o-mini", // 使用性价比高的新模型
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" }, // 强制要求返回JSON对象
        temperature: 0.2, // 对于评分任务，使用较低的温度以保证结果的稳定性
        max_tokens: 500
      };

      const options = {
        method: "post",
        contentType: "application/json",
        headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
        payload: JSON.stringify(payload),
        muteHttpExceptions: true
      };

      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", options);
      const responseCode = response.getResponseCode();
      const responseBody = response.getContentText();

      if (responseCode === 200) {
        const jsonResponse = JSON.parse(responseBody);
        if (jsonResponse.choices && jsonResponse.choices.length > 0 && jsonResponse.choices[0].message) {
          // 再次解析内容中的JSON字符串
          return JSON.parse(jsonResponse.choices[0].message.content);
        } else {
          throw new Error("AI响应格式不正确，缺少choices或message。");
        }
      } else {
        throw new Error(`AI API返回错误，状态码: ${responseCode}, 响应: ${responseBody}`);
      }
    } catch (e) {
      Logger.log(`[${wfName}] AI调用失败: ${e.message}`);
      // 在工作流日志中也记录这个错误
      if (logContext.logMessages) {
          logContext.logMessages.push(`警告: AI评估失败 - ${e.message}`);
      }
      return null; // 返回null表示失败，让调用方可以处理
    }
  },
  
  // =========================================================================
  //  第一层：数据采集工作流 (WF1 - WF6)
  // =========================================================================

  runWf1_AcademicPapers: function() {
    const wfName = 'WF1: 学术论文监控';
    const startTime = new Date();
    const executionId = `exec_wf1_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0;

    try {
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY');
      const activeTechs = techRegistry.filter(t => t.monitoring_status === 'active' && t.data_source_academic === true);
      logMessages.push(`发现 ${activeTechs.length} 个活跃的技术监控项。`);
      processedCount = activeTechs.length;

      if (activeTechs.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有需要监控的活跃技术项。");
        return { success: true, message: "没有需要监控的活跃技术项。", log: logMessages.join('\n') };
      }
      
      let allNewPaperObjects = [];

      for (const tech of activeTechs) {
        const searchTerms = (tech.academic_search_terms || "").split(',').map(s => s.trim()).filter(Boolean);
        for (const term of searchTerms) {
          logMessages.push(`正在为技术 '${tech.tech_name}' 搜索关键词: '${term}'...`);
          const apiUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(term)}&sortBy=submittedDate&sortOrder=descending&max_results=5`; // 减少每次获取的数量，避免超时
          const response = UrlFetchApp.fetch(apiUrl, { muteHttpExceptions: true });
          
          if (response.getResponseCode() !== 200) {
              logMessages.push(`警告: 调用arXiv API失败，状态码: ${response.getResponseCode()}`);
              errorCount++;
              continue;
          }

          const xml = response.getContentText();
          const document = XmlService.parse(xml);
          const root = document.getRootElement();
          const atomNs = XmlService.getNamespace('http://www.w3.org/2005/Atom');
          const entries = root.getChildren('entry', atomNs);

          for (const entry of entries) {
            const title = entry.getChild('title', atomNs).getText();
            const summary = entry.getChild('summary', atomNs).getText();
            
            // ✅ 核心修改：调用 AI 进行评分
            logMessages.push(`  -> 正在为论文 "${title.substring(0,30)}..." 调用 AI 评估...`);
            const prompt = `
              请评估以下学术论文的创新程度，并严格以 JSON 格式返回评分。
              创新程度 (innovation_score) 标准为1-10的整数，10为最高创新。
              
              论文标题: ${title}
              论文摘要: ${summary}
              
              返回JSON格式:
              {
                "innovation_score": <分数>
              }
            `;
            const aiAssessment = this._callAIForScoring(prompt, { wfName, executionId, logMessages });

            if (!aiAssessment || typeof aiAssessment.innovation_score === 'undefined') {
                logMessages.push(`  -> AI 评估失败或返回格式不正确，跳过此论文。`);
                errorCount++;
                continue;
            }
            
            const innovationScore = parseFloat(aiAssessment.innovation_score);
            logMessages.push(`  -> AI 评估创新分: ${innovationScore}`);

            // 只处理 AI 认为有较高创新性的论文
            if (innovationScore >= 7.0) {
              const paperUrl = entry.getChild('id', atomNs).getText();
              const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, paperUrl);
              const duplicateHash = this._bytesToHex(hashBytes);
              const raw_id = `RAW_AP_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

              const paperDataObject = {
                raw_id: raw_id,
                id: raw_id,
                source_type: 'academic_papers',
                title: title,
                abstract: summary,
                authors: entry.getChildren('author', atomNs).map(a => a.getChild('name', atomNs).getText()).join(', '),
                publication_date: new Date(entry.getChild('published', atomNs).getText()),
                source_url: paperUrl,
                source_platform: 'arXiv',
                innovation_score: innovationScore,
                tech_keywords: tech.tech_keywords,
                processing_status: 'pending',
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date(),
                duplicate_check_hash: duplicateHash
              };
              allNewPaperObjects.push(paperDataObject);
              successCount++;
            }
          }
        }
      }
      
      if (allNewPaperObjects.length > 0) {
        DataService.batchUpsert('RAW_ACADEMIC_PAPERS', allNewPaperObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewPaperObjects.length} 条高创新性论文数据。`);
      }
      
      const finalMessage = `成功处理 ${processedCount} 个技术项，发现 ${successCount} 篇高创新性论文。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // ... (WF2 - WF6 的函数将在这里添加，暂时留空)
  runWf2_PatentData: function() { return { success: false, message: "WF2 功能尚未实现。", log: "WF2 功能尚未实现。" }; },
    /**
   * ✅ 新增实现: 执行 WF3: 开源项目监测
   */
  // 在 backend/svc.Workflows.gs 中

runWf3_OpenSource: function() {
    const wfName = 'WF3: 开源项目监测';
    const startTime = new Date();
    const executionId = `exec_wf3_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0;

    try {
      // ✅ 核心修正 1: 使用新的 DataService 从 Firestore 获取数据
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY')
                                     .filter(t => t.monitoring_status === 'active' && t.data_source_opensource === true);
      
      processedCount = techRegistry.length;
      logMessages.push(`发现 ${processedCount} 个需要监控开源项目的技术领域。`);

      if (processedCount === 0) {
        const msg = "没有需要监控开源项目的活跃技术领域。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      let allNewProjectsObjects = [];
      const githubToken = PropertiesService.getScriptProperties().getProperty('GITHUB_API_KEY');
      
      const headers = {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'TechInsight-Engine/1.0'
      };
      if (githubToken) {
        headers['Authorization'] = `token ${githubToken}`;
      } else {
        logMessages.push("警告: 未配置 GitHub API Token，将以匿名模式执行。");
      }
      
      const options = { headers: headers, muteHttpExceptions: true };

      for (const tech of techRegistry) {
        const searchTerms = (tech.tech_keywords || "").split(',').map(s => s.trim()).filter(Boolean);
        for (const term of searchTerms) {
          logMessages.push(`正在为技术 '${tech.tech_name}' 搜索开源项目: '${term}'...`);
          
          const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(term)}&sort=updated&order=desc&per_page=5`;
          const response = UrlFetchApp.fetch(apiUrl, options);

          if (response.getResponseCode() !== 200) {
            logMessages.push(`警告: 调用GitHub API失败，状态码: ${response.getResponseCode()}`);
            errorCount++;
            continue;
          }

          const searchResult = JSON.parse(response.getContentText());
          const projects = searchResult.items || [];

          for (const project of projects) {
            if (project.stargazers_count < 50) continue; // 过滤掉星数过低的项目

            const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, project.html_url);
            const duplicateHash = this._bytesToHex(hashBytes);
            const raw_id = `RAW_OS_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;
            
            const projectDataObject = {
                raw_id: raw_id,
                id: raw_id,
                source_type: 'opensource_data',
                project_name: project.full_name,
                description: (project.description || '').substring(0, 500),
                main_language: project.language || '',
                source_url: project.html_url,
                github_stars: project.stargazers_count,
                github_forks: project.forks_count,
                last_commit_date: new Date(project.updated_at),
                contributor_count: project.watchers_count, // watchers_count 通常代表关注者
                tech_keywords: tech.tech_keywords,
                processing_status: 'pending', // 初始状态为待处理，等待 WF7-3 进行 AI 评估
                duplicate_check_hash: duplicateHash,
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date()
            };

            allNewProjectsObjects.push(projectDataObject);
            successCount++;
          }
        }
      }

      if (allNewProjectsObjects.length > 0) {
        // ✅ 核心修正 2: 使用新的 DataService 批量写入
        DataService.batchUpsert('RAW_OPENSOURCE_DATA', allNewProjectsObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewProjectsObjects.length} 条新开源项目数据。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个技术领域，发现并写入了 ${successCount} 个相关开源项目。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

    /**
   * ✅ 新增实现: 执行 WF4: 技术新闻获取
   */
  runWf4_TechNews: function() {
    const wfName = 'WF4: 技术新闻获取';
    const startTime = new Date();
    const executionId = `exec_wf4_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0;

    try {
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY').filter(t => t.monitoring_status === 'active' && t.data_source_news === true);
      const competitorRegistry = DataService.getDataAsObjects('COMPETITOR_REGISTRY').filter(c => c.monitoring_status === 'active' && c.news_monitoring === true);
      
      const searchEntities = [...techRegistry, ...competitorRegistry];
      processedCount = searchEntities.length;
      logMessages.push(`发现 ${techRegistry.length} 个技术监控项和 ${competitorRegistry.length} 个业绩标杆监控项。`);

      if (searchEntities.length === 0) {
        const msg = "没有需要监控新闻的活跃实体。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const allNewArticles = [];
      const newsApiKey = PropertiesService.getScriptProperties().getProperty('NEWS_API_KEY');
      if (!newsApiKey) throw new Error("NewsAPI Key 未在项目属性中配置。");

      for (const entity of searchEntities) {
        const isTech = !!entity.tech_name;
        const query = isTech ? `"${entity.tech_name}" OR (${(entity.tech_keywords || '').replace(/,/g, ' OR ')})` : `"${entity.company_name}"`;
        logMessages.push(`正在为 '${isTech ? entity.tech_name : entity.company_name}' 搜索新闻...`);

        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=5`;
        const response = UrlFetchApp.fetch(apiUrl, { headers: { 'X-Api-Key': newsApiKey }, muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          logMessages.push(`警告: 调用 NewsAPI 失败，状态码: ${response.getResponseCode()}`);
          errorCount++;
          continue;
        }

        const articles = JSON.parse(response.getContentText()).articles || [];
        for (const article of articles) {
          // ✅ 核心修改：调用 AI 进行评分
          logMessages.push(`  -> 正在为新闻 "${(article.title || "").substring(0,30)}..." 调用 AI 评估...`);
          const prompt = `
            请评估以下技术新闻的新闻价值和市场影响，并严格以JSON格式返回评分。
            评分标准为1-10的整数。
            新闻标题: ${article.title}
            新闻摘要: ${article.description || ''}
            
            返回JSON格式:
            {
              "news_value_score": <新闻价值分数>,
              "market_impact_score": <市场影响分数>
            }
          `;
          const aiScores = this._callAIForScoring(prompt, { wfName, executionId, logMessages });

          if (!aiScores || typeof aiScores.news_value_score === 'undefined') {
              logMessages.push(`  -> AI 评估失败，跳过此新闻。`);
              errorCount++;
              continue;
          }
          
          const newsValueScore = parseFloat(aiScores.news_value_score);
          const marketImpactScore = parseFloat(aiScores.market_impact_score);
          logMessages.push(`  -> AI 评估新闻价值分: ${newsValueScore}, 市场影响分: ${marketImpactScore}`);

          // 只处理 AI 认为有较高价值的新闻
          if (newsValueScore >= 7.0) {
              const articleUrl = article.url;
              const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, articleUrl);
              const duplicateHash = this._bytesToHex(hashBytes);
              const raw_id = `RAW_TN_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

              const newsDataObject = {
                raw_id: raw_id,
                id: raw_id,
                source_type: 'tech_news',
                news_title: article.title,
                news_summary: (article.description || '').substring(0, 500),
                source_url: articleUrl,
                publication_date: new Date(article.publishedAt),
                source_platform: article.source.name,
                author: article.author || '',
                related_companies: isTech ? '' : entity.company_name,
                tech_keywords: isTech ? entity.tech_keywords : '',
                processing_status: 'pending',
                news_value_score: newsValueScore,
                market_impact_score: marketImpactScore,
                duplicate_check_hash: duplicateHash,
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date()
              };

              allNewArticles.push(newsDataObject);
              successCount++;
          }
        }
      }
      if (allNewArticles.length > 0) {
        DataService.batchUpsert('RAW_TECH_NEWS', allNewArticles, 'raw_id');
        logMessages.push(`成功写入 ${allNewArticles.length} 条新新闻数据。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个实体，发现 ${successCount} 篇高价值文章。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },
  // 在 backend/svc.Workflows.gs 中

runWf5_IndustryDynamics: function() {
    const wfName = 'WF5: 产业动态/会议新闻捕获';
    const startTime = new Date();
    const executionId = `exec_wf5_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0;

    try {
      // ✅ 核心修正 1: 使用新的 DataService 从 Firestore 获取数据
      const conferenceRegistry = DataService.getDataAsObjects('CONFERENCE_REGISTRY');
      if (!conferenceRegistry) {
          throw new Error("无法从 'CONFERENCE_REGISTRY' 获取数据，可能集合不存在或为空。");
      }
      
      const activeConferences = conferenceRegistry.filter(c => c.monitoring_status && String(c.monitoring_status).toLowerCase() === 'active');
      processedCount = activeConferences.length;
      logMessages.push(`发现 ${processedCount} 个需要监控的活跃会议。`);

      if (processedCount === 0) {
        const msg = "在 Conference_Registry 中没有找到 'monitoring_status' 为 'active' 的会议。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const newsApiKey = PropertiesService.getScriptProperties().getProperty('NEWS_API_KEY');
      if (!newsApiKey) throw new Error("NewsAPI Key 未在项目属性中配置 (NEWS_API_KEY)。");

      let allNewDynamicsObjects = [];

      for (const conf of activeConferences) {
        const query = `"${conf.conference_name}" OR "${conf.conference_id}"`;
        logMessages.push(`正在为会议 '${conf.conference_name}' 搜索相关新闻...`);

        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=5`;
        const response = UrlFetchApp.fetch(apiUrl, { headers: { 'X-Api-Key': newsApiKey }, muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          logMessages.push(`  -> 警告: 调用 NewsAPI 失败 (状态码: ${response.getResponseCode()})。`);
          errorCount++;
          continue;
        }

        const articles = JSON.parse(response.getContentText()).articles || [];
        logMessages.push(`  -> 找到 ${articles.length} 篇文章。`);

        for (const article of articles) {
          // ✅ 核心修正 2: 调用 AI 进行评分
          const prompt = `
            请评估以下新闻的产业影响力和与技术趋势的相关性。请严格以JSON格式返回评分。
            评分标准为1-10的整数。

            新闻标题: ${article.title}
            新闻摘要: ${article.description || ''}

            返回JSON格式:
            {
              "industry_impact_score": <产业影响分数>,
              "relevance_score": <技术相关性分数>
            }
          `;
          const aiScores = this._callAIForScoring(prompt, { wfName, executionId, logMessages });

          if (!aiScores || typeof aiScores.industry_impact_score === 'undefined') {
            logMessages.push(`  -> 跳过文章，因为AI评估失败或返回格式不正确。`);
            errorCount++;
            continue;
          }

          const industryImpactScore = parseFloat(aiScores.industry_impact_score);
          const relevanceScore = parseFloat(aiScores.relevance_score);

          if (industryImpactScore >= 6.0 && relevanceScore >= 7.0) {
            const articleUrl = article.url;
            const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, articleUrl);
            const duplicateHash = this._bytesToHex(hashBytes);
            const raw_id = `RAW_ID_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

            const dynamicsDataObject = {
              raw_id: raw_id,
              id: raw_id,
              source_type: 'industry_dynamics',
              event_title: article.title,
              event_summary: (article.description || '').substring(0, 500),
              source_url: articleUrl,
              publication_date: new Date(article.publishedAt),
              source_platform: article.source.name,
              event_type: 'Conference News',
              tech_keywords: conf.industry_focus,
              industry_category: conf.industry_focus,
              processing_status: 'pending',
              industry_impact_score: industryImpactScore,
              relevance_score: relevanceScore,
              duplicate_check_hash: duplicateHash,
              workflow_execution_id: executionId,
              created_timestamp: new Date(),
              last_update_timestamp: new Date()
            };
            allNewDynamicsObjects.push(dynamicsDataObject);
            successCount++;
            logMessages.push(`  -> 记录高价值会议新闻: '...' (影响分: ${industryImpactScore}, 相关分: ${relevanceScore})`);
          }
        }
      }

      if (allNewDynamicsObjects.length > 0) {
        // ✅ 核心修正 3: 使用新的 DataService 批量写入
        DataService.batchUpsert('RAW_INDUSTRY_DYNAMICS', allNewDynamicsObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewDynamicsObjects.length} 条新产业动态数据。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个会议，发现并写入了 ${successCount} 条相关新闻。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf6_Benchmark: function() {
    const wfName = 'WF6: 业绩标杆线索收集';
    const startTime = new Date();
    const executionId = `exec_wf6_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0;

    try {
      // 1. 从 Competitor_Registry 获取需要监控的业绩标杆
      const competitorRegistry = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.COMPETITOR_REGISTRY);
      if (!competitorRegistry) {
        throw new Error(`无法从 ${CONFIG.SHEET_NAMES.COMPETITOR_REGISTRY} 获取数据。`);
      }
      
      const activeCompetitors = competitorRegistry.filter(c => 
        c.monitoring_status && String(c.monitoring_status).toLowerCase() === 'active' &&
        c.news_monitoring && String(c.news_monitoring).toLowerCase() === 'true'
      );

      processedCount = activeCompetitors.length;
      logMessages.push(`发现 ${processedCount} 个需要监控新闻的活跃业绩标杆。`);

      if (processedCount === 0) {
        const msg = "在 Competitor_Registry 中没有找到需要监控新闻的活跃业绩标杆。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      // 2. 准备API调用
      const newsApiKey = PropertiesService.getScriptProperties().getProperty('NEWS_API_KEY');
      if (!newsApiKey) throw new Error("NewsAPI Key 未在项目属性中配置 (NEWS_API_KEY)。");

      const allNewIntel = [];
      const TABLE_HEADERS = [
        'raw_id', 'source_type', 'intelligence_title', 'intelligence_summary', 'source_url', 'publication_date',
        'source_platform', 'author', 'competitor_name', 'intelligence_type', 'tech_keywords', 'processing_status',
        'linked_intelligence_id', 'threat_level_score', 'business_impact_score', 'duplicate_check_hash',
        'workflow_execution_id', 'created_timestamp', 'processed_timestamp', 'last_update_timestamp'
      ];

      // 3. 遍历每个业绩标杆，获取新闻
      for (const competitor of activeCompetitors) {
        const query = `"${competitor.company_name}"`;
        logMessages.push(`正在为业绩标杆 '${competitor.company_name}' 搜索新闻...`);

        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=10`;
        const response = UrlFetchApp.fetch(apiUrl, { headers: { 'X-Api-Key': newsApiKey }, muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          logMessages.push(`  -> 警告: 调用 NewsAPI 失败 (状态码: ${response.getResponseCode()})。跳过此业绩标杆。`);
          errorCount++;
          continue;
        }

        const articles = JSON.parse(response.getContentText()).articles || [];
        logMessages.push(`  -> 找到 ${articles.length} 篇文章。`);

        for (const article of articles) {
          // 4. 数据准备，此处不进行AI评分，留到WF7-6处理
          const articleUrl = article.url;
          const hashBytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, articleUrl);
          const duplicateHash = this._bytesToHex(hashBytes);
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const rawId = `RAW_CI_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

          const rowDataObject = {
            raw_id: rawId,
            source_type: 'competitor_intelligence',
            intelligence_title: article.title,
            intelligence_summary: (article.description || '').substring(0, 500),
            source_url: articleUrl,
            publication_date: (article.publishedAt || '').split('T')[0],
            source_platform: article.source.name,
            author: article.author || '',
            competitor_name: competitor.company_name,
            intelligence_type: 'General News', // 初始类型，可在WF7-6中由AI细化
            tech_keywords: '', // 留空，待AI分析
            processing_status: 'pending', // 核心状态
            linked_intelligence_id: '',
            threat_level_score: 0, // 待AI评估
            business_impact_score: 0, // 待AI评估
            duplicate_check_hash: duplicateHash,
            workflow_execution_id: executionId,
            created_timestamp: nowTimestamp,
            processed_timestamp: '',
            last_update_timestamp: nowTimestamp
          };

          const intelDataRow = TABLE_HEADERS.map(header => rowDataObject[header] !== undefined ? rowDataObject[header] : '');
          allNewIntel.push(intelDataRow);
          successCount++;
        }
      }

      // 5. 批量写入数据
      if (allNewIntel.length > 0) {
        const sheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE);
        sheet.getRange(sheet.getLastRow() + 1, 1, allNewIntel.length, TABLE_HEADERS.length).setValues(allNewIntel);
        logMessages.push(`成功写入 ${allNewIntel.length} 条新竞争线索数据。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个业绩标杆，发现并写入了 ${successCount} 条相关新闻。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // =========================================================================
  //  第二层：信号识别工作流 (WF7-1 - WF7-6)
  // =========================================================================

    /**
   * ✅ 修正版: 执行 WF7-1: 学术论文信号识别 (修正表头和数据行索引)
   */
  runWf7_1_AcademicSignalIdentification: function() {
    const wfName = 'WF7-1: 学术论文信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_1_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;

    try {
      // 1. 读取数据 (调用方式简化)
      const allPapers = DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS');
      const pendingPapers = allPapers.filter(paper => paper.processing_status && String(paper.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingPapers.length} 条待处理的论文记录。`);
      if (pendingPapers.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      const rawPaperSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS);
      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      
      // 2. 准备写入 (不再需要 SpreadsheetApp 对象)
      const newIntelligenceObjects = []; // ✅ 存放对象，而不是数组
      const updatesForRawSheet = []; // 保持不变，存放更新任务

      for (const paper of pendingPapers) {
        processedCount++;
        logMessages.push(`正在处理论文: ${paper.title.substring(0, 50)}...`);

        // ✅ 核心修正 1: 设计一个更全面的AI Prompt，一次性获取所有需要的分析内容
        const prompt = `
          请作为一名资深的技术与商业分析师，深入分析以下学术论文，并严格以JSON格式返回。
          
          论文标题: ${paper.title}
          论文摘要: ${paper.abstract}

          你需要完成以下任务:
          1.  评估技术突破性和影响范围，并给出1-10分的评分。
          2.  评估商业潜力和可行性，并给出1-10分的评分。
          3.  总结这篇论文的突破性分析理由 (breakthrough_reason)。
          4.  提炼其核心的价值主张 (value_proposition)。
          5.  列出1-3个关键创新点 (key_innovations)，以数组形式表示。
          6.  预测其可能的目标行业 (target_industries)，以数组形式表示。

          返回的 JSON 格式必须是:
          {
            "breakthrough_score": <技术突破性评分>,
            "impact_scope": <影响范围评分>,
            "revenue_potential": <收入潜力评分>,
            "commercialization_feasibility": <商业化可行性评分>,
            "breakthrough_reason": "<对技术突破性的详细分析理由>",
            "value_proposition": "<对该技术核心商业价值的精炼总结>",
            "key_innovations": ["创新点1", "创新点2"],
            "target_industries": ["行业1", "行业2"]
          }
        `;
        
        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        if (!aiAssessment) {
          logMessages.push(`  -> AI评估失败，跳过此论文。`);
          updatesForRawSheet.push({ raw_id: paper.raw_id, status: 'failed', linkedId: '' });
          continue;
        }

        const breakthroughScore = parseFloat(aiAssessment.breakthrough_score) || 0;
        const impactScope = parseFloat(aiAssessment.impact_scope) || 0;
        const revenuePotential = parseFloat(aiAssessment.revenue_potential) || 0;
        const innovationDegree = parseFloat(paper.innovation_score) || breakthroughScore;
        
        const signalStrength = (breakthroughScore * 0.4) + (revenuePotential * 0.3) + (impactScope * 0.2) + (innovationDegree * 0.1);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);

        if (signalStrength >= 8.0) {
          newSignalsCount++;
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const intelligenceId = `TI${Utilities.formatDate(new Date(), 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          // ✅ 核心修正 2: 使用AI返回的真实分析内容填充记录
          const intelligenceObject = {
            intelligence_id: intelligenceId,
            tech_id: paper.tech_id || '',
            tech_keywords: paper.tech_keywords,
            title: paper.title,
            content_summary: String(paper.abstract).substring(0, 500),
            trigger_source: 'academic_papers',
            source_url: paper.source_url,
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)),
            breakthrough_score: parseFloat(breakthroughScore.toFixed(2)),
            commercial_value_score: parseFloat(revenuePotential.toFixed(2)),
            confidence_level: 'medium',
            priority: 'high',
            processing_status: 'signal_identified',
            breakthrough_reason: aiAssessment.breakthrough_reason || "N/A",
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_innovations || []).join(', '),
            target_industries: (aiAssessment.target_industries || []).join(', '),
            version: 1,
            is_deleted: 0,
            created_timestamp: new Date(),
            updated_timestamp: new Date(),
            source_table: 'Raw_Academic_Papers',
            source_record_id: paper.raw_id
        };
        newIntelligenceObjects.push(intelligenceObject); // ✅ 添加对象
        updatesForRawSheet.push({ raw_id: paper.raw_id, status: 'processed', linkedId: intelligenceId });
        } else {
            updatesForRawSheet.push({ raw_id: paper.raw_id, status: 'processed', linkedId: '' });
        }
      }

      // 批量写入和回填
      if (newIntelligenceObjects.length > 0) {
          // ✅ 直接调用新的写入方法
          DataService.batchAppendObjects('TECH_INSIGHTS_MASTER', newIntelligenceObjects);
          logMessages.push(`成功写入 ${newIntelligenceObjects.length} 条新线索记录。`);
      }

      if (updatesForRawSheet.length > 0) {
        // ✅ 直接循环并调用更新方法，无需再读取整个表格
        logMessages.push(`准备回填更新 ${updatesForRawSheet.length} 条原始记录...`);
        for (const update of updatesForRawSheet) {
            DataService.updateObject('RAW_ACADEMIC_PAPERS', update.raw_id, {
                processing_status: update.status,
                linked_intelligence_id: update.linkedId,
                processed_timestamp: new Date() // ✅ 同时更新处理时间戳
            });
        }
        logMessages.push(`成功回填更新 ${updatesForRawSheet.length} 条原始记录的状态。`);
      }
      
      const finalMessage = `处理了 ${processedCount} 篇论文，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, 0, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // ... (WF7-2 - WF7-6 的函数将在这里添加，暂时留空)
  runWf7_2: function() { return { success: false, message: "WF7-2 功能尚未实现。", log: "WF7-2 功能尚未实现。" }; },

  runWf7_3_OpenSourceSignal: function() {
    const wfName = 'WF7-3: 开源项目信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_3_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;

    try {
      const allProjects = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA);
      const pendingProjects = allProjects.filter(p => p.processing_status && String(p.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingProjects.length} 条待处理的开源项目记录。`);
      if (pendingProjects.length === 0) {
        const msg = "没有待处理记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const rawSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA);
      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      
      const newIntelligenceRecords = [];
      const updatesForRawSheet = [];

      for (const project of pendingProjects) {
        processedCount++;
        logMessages.push(`正在处理项目: ${project.project_name}...`);

        const prompt = `
          请作为一名资深的技术与社区分析师，深入分析以下开源项目，并严格以JSON格式返回。
          
          项目名称: ${project.project_name}
          项目描述: ${project.description}
          主要语言: ${project.main_language}
          Stars: ${project.github_stars}
          Forks: ${project.github_forks}
          最后更新: ${project.last_commit_date}

          你需要完成以下任务:
          1. 评估项目的技术潜力 (project_potential_score)，考虑其创新性、解决的问题等，评分1-10。
          2. 评估项目的社区活跃度和采用趋势 (adoption_trend)，考虑stars, forks, 更新频率等，评分1-10。
          3. 总结该项目的核心价值主张 (value_proposition)。
          4. 列出1-3个关键创新点或特性 (key_innovations)，以数组形式表示。

          返回的 JSON 格式必须是:
          {
            "project_potential_score": <技术潜力评分>,
            "adoption_trend": <采用趋势评分>,
            "value_proposition": "<对该项目核心价值的精炼总结>",
            "key_innovations": ["创新点1", "创新点2"]
          }
        `;
        
        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        if (!aiAssessment) {
          logMessages.push(`  -> AI评估失败，跳过此项目。`);
          updatesForRawSheet.push({ raw_id: project.raw_id, status: 'failed', linkedId: '' });
          continue;
        }

        const potentialScore = parseFloat(aiAssessment.project_potential_score) || 0;
        const adoptionTrend = parseFloat(aiAssessment.adoption_trend) || 0;
        
        const signalStrength = (potentialScore * 0.6) + (adoptionTrend * 0.4);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);

        if (signalStrength >= 8.0) {
          newSignalsCount++;
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const intelligenceId = `TI${Utilities.formatDate(new Date(), 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceRecord = [
            intelligenceId, 
            project.tech_id || '', 
            project.tech_keywords, 
            project.project_name,
            String(project.description).substring(0, 500), 
            'opensource_data', 
            project.source_url, 
            wfName,
            signalStrength.toFixed(2), 
            potentialScore.toFixed(2),
            adoptionTrend.toFixed(2),
            'medium', 
            'medium', 
            'signal_identified', 
            `项目潜力得分 ${potentialScore}, 社区趋势得分 ${adoptionTrend}`,
            aiAssessment.value_proposition || "N/A",
            (aiAssessment.key_innovations || []).join(', '),
            "开发者社区, 初创公司",
            1, 0, nowTimestamp, nowTimestamp, 'Raw_OpenSource_Data', project.raw_id
          ];
          newIntelligenceRecords.push(intelligenceRecord);
          updatesForRawSheet.push({ raw_id: project.raw_id, status: 'processed', linkedId: intelligenceId });
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceId}`);
        } else {
            // ✅ 核心修正：将被跳过的状态也更新为 'processed'，以符合数据验证规则
            updatesForRawSheet.push({ raw_id: project.raw_id, status: 'processed', linkedId: '' });
        }
      }

      if (newIntelligenceRecords.length > 0) {
        intelSheet.getRange(intelSheet.getLastRow() + 1, 1, newIntelligenceRecords.length, newIntelligenceRecords[0].length).setValues(newIntelligenceRecords);
        logMessages.push(`成功写入 ${newIntelligenceRecords.length} 条新线索记录。`);
      }

      if (updatesForRawSheet.length > 0) {
        const rawDataForUpdate = rawSheet.getDataRange().getValues();
        const rawHeaders = rawDataForUpdate[0];
        const rawHeaderMap = rawHeaders.reduce((acc, h, i) => { acc[String(h).trim()] = i; return acc; }, {});
        
        const idCol = rawHeaderMap['raw_id'];
        const statusCol = rawHeaderMap['processing_status'];
        const linkedIdCol = rawHeaderMap['linked_intelligence_id'];

        if (typeof idCol === 'undefined' || typeof statusCol === 'undefined' || typeof linkedIdCol === 'undefined') {
            throw new Error("在 Raw_OpenSource_Data 表中找不到关键列 (raw_id, processing_status, or linked_intelligence_id)。");
        }

        const updateMap = updatesForRawSheet.reduce((acc, u) => { acc[u.raw_id] = u; return acc; }, {});
        let changesMade = false;
        for (let i = 2; i < rawDataForUpdate.length; i++) {
            const rowId = rawDataForUpdate[i][idCol];
            if (rowId && updateMap[rowId]) {
                rawDataForUpdate[i][statusCol] = updateMap[rowId].status;
                rawDataForUpdate[i][linkedIdCol] = updateMap[rowId].linkedId;
                changesMade = true;
                delete updateMap[rowId];
            }
        }
        if (changesMade) {
            rawSheet.getRange(1, 1, rawDataForUpdate.length, rawDataForUpdate[0].length).setValues(rawDataForUpdate);
            logMessages.push(`成功回填更新 ${updatesForRawSheet.length} 条原始记录的状态。`);
        }
      }
      
      const finalMessage = `处理了 ${processedCount} 个开源项目，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, 0, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },
    /**
   * ✅ 新增实现: 执行 WF7-4: 技术新闻信号识别
   */
    /**
   * ✅ 修正版: 执行 WF7-4: 技术新闻信号识别 (修复 pending 记录识别问题)
   */
  runWf7_4TechNewsSignal: function() {
    const wfName = 'WF7-4: 技术新闻信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_4_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0, newSignalsCount = 0;

    try {
      const allNews = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS);
      const pendingNews = allNews.filter(news => news.processing_status && String(news.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingNews.length} 条待处理的新闻记录。`);
      if (pendingNews.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      const rawNewsSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_TECH_NEWS);
      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      
      const newIntelligenceRecords = [];
      const updatesForRawSheet = [];

      for (const news of pendingNews) {
        processedCount++;
        logMessages.push(`正在处理新闻: ${news.news_title.substring(0, 50)}...`);

        // ✅ 核心修正 1: 设计一个更全面的AI Prompt
        const prompt = `
          请作为一名资深的技术与商业分析师，深入分析以下技术新闻，并严格以JSON格式返回。
          
          新闻标题: ${news.news_title}
          新闻摘要: ${news.news_summary}
          来源平台: ${news.source_platform}
          相关公司: ${news.related_companies}

          你需要完成以下任务:
          1.  评估技术突破性、市场影响和战略重要性，并给出1-10分的评分。
          2.  总结这篇新闻揭示的技术突破性分析理由 (breakthrough_reason)。
          3.  提炼其核心的价值主张 (value_proposition)。
          4.  列出1-3个关键创新点或新闻要点 (key_innovations)，以数组形式表示。
          5.  预测其可能的目标行业 (target_industries)，以数组形式表示。

          返回的 JSON 格式必须是:
          {
            "breakthrough_score": <技术突破性评分>,
            "market_impact_score": <市场影响评分>,
            "strategic_importance": <战略重要性评分>,
            "breakthrough_reason": "<对新闻中技术突破性的详细分析理由>",
            "value_proposition": "<对该新闻核心商业价值的精炼总结>",
            "key_innovations": ["关键点1", "关键点2"],
            "target_industries": ["行业1", "行业2"]
          }
        `;
        
        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        if (!aiAssessment) {
          logMessages.push(`  -> AI评估失败，跳过此新闻。`);
          updatesForRawSheet.push({ raw_id: news.raw_id, status: 'failed', linkedId: '' });
          continue;
        }

        const breakthroughScore = parseFloat(aiAssessment.breakthrough_score) || 0;
        const marketImpact = parseFloat(aiAssessment.market_impact_score) || 0;
        const strategicImportance = parseFloat(aiAssessment.strategic_importance) || 0;
        const newsValue = parseFloat(news.news_value_score) || ((marketImpact + strategicImportance) / 2);

        const signalStrength = (breakthroughScore * 0.4) + (marketImpact * 0.3) + (strategicImportance * 0.2) + (newsValue * 0.1);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);

        if (signalStrength >= 7.5) {
          newSignalsCount++;
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const intelligenceId = `TI${Utilities.formatDate(new Date(), 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          // ✅ 核心修正 2: 使用AI返回的真实分析内容填充记录
          const intelligenceRecord = [
            intelligenceId, news.tech_id || '', news.tech_keywords, news.news_title,
            String(news.news_summary).substring(0, 500), 'tech_news', news.source_url, wfName,
            signalStrength.toFixed(2), 
            breakthroughScore.toFixed(2), 
            marketImpact.toFixed(2), // 使用市场影响分作为商业价值的代理
            'medium', 'medium', 'signal_identified', 
            aiAssessment.breakthrough_reason || "N/A",
            aiAssessment.value_proposition || "N/A",
            (aiAssessment.key_innovations || []).join(', '),
            (aiAssessment.target_industries || []).join(', '),
            1, 0, nowTimestamp, nowTimestamp, 'Raw_Tech_News', news.raw_id
          ];
          newIntelligenceRecords.push(intelligenceRecord);
          updatesForRawSheet.push({ raw_id: news.raw_id, status: 'processed', linkedId: intelligenceId });
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceId}`);
        } else {
            updatesForRawSheet.push({ raw_id: news.raw_id, status: 'processed', linkedId: '' });
        }
      }

      if (newIntelligenceRecords.length > 0) {
        const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
        intelSheet.getRange(intelSheet.getLastRow() + 1, 1, newIntelligenceRecords.length, newIntelligenceRecords[0].length).setValues(newIntelligenceRecords);
        logMessages.push(`成功写入 ${newIntelligenceRecords.length} 条新线索记录。`);
      }

      if (updatesForRawSheet.length > 0) {
        logMessages.push(`准备回填更新 ${updatesForRawSheet.length} 条原始记录...`);
        // ✅ 核心修正 2: 使用更安全的方式进行批量更新
        updatesForRawSheet.forEach(update => {
          if (update.rowIndex && Number.isInteger(update.rowIndex) && update.rowIndex > 0) {
            rawNewsSheet.getRange(update.rowIndex, statusColIndex + 1).setValue(update.status);
            rawNewsSheet.getRange(update.rowIndex, linkedIdColIndex + 1).setValue(update.linkedId);
          } else {
            logMessages.push(`警告: 无效的行索引，跳过更新: ${JSON.stringify(update)}`);
          }
        });
        logMessages.push(`成功更新 ${updatesForRawSheet.length} 条原始记录的状态。`);
      }

      const finalMessage = `处理了 ${processedCount} 篇新闻，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, 0, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, 1, errorMessage);
      return { success: false, message: e.message, log: logMessages.join('\n') };
    }
  },
  runWf7_5IndustryDynamics: function() {
    const wfName = 'WF7-5: 产业动态信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_5_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allDynamics = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS);
      const pendingDynamics = allDynamics.filter(item => item.processing_status && String(item.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingDynamics.length} 条待处理的产业动态记录。`);
      if (pendingDynamics.length === 0) {
        const msg = "没有待处理的产业动态记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const rawDynamicsSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS);
      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      
      const newIntelligenceRecords = [];
      const updatesForRawSheet = [];

      for (const dynamic of pendingDynamics) {
        processedCount++;
        logMessages.push(`正在处理产业动态: ${dynamic.event_title.substring(0, 50)}...`);

        // 1. 设计AI Prompt进行深度分析
        const prompt = `
          请作为一名资深的市场与技术战略分析师，深入分析以下产业动态信息，并严格以JSON格式返回。
          
          事件标题: ${dynamic.event_title}
          事件摘要: ${dynamic.event_summary}
          相关技术关键词: ${dynamic.tech_keywords}
          产业分类: ${dynamic.industry_category}

          你需要完成以下任务:
          1. 评估此动态对相关技术领域的潜在商业价值 (commercial_value_score)，评分1-10。
          2. 评估此动态所揭示的技术突破性或应用创新性 (breakthrough_score)，评分1-10。
          3. 评估此动态对我们可能产生的战略机遇或威胁 (strategic_impact_score)，评分1-10。
          4. 总结其核心的价值主张 (value_proposition)，描述它解决了什么问题或带来了什么新机会。
          5. 列出1-3个关键创新点或新闻要点 (key_innovations)，以数组形式表示。
          6. 预测其可能影响的目标行业 (target_industries)，以数组形式表示。

          返回的 JSON 格式必须是:
          {
            "commercial_value_score": <商业价值评分>,
            "breakthrough_score": <技术突破性评分>,
            "strategic_impact_score": <战略影响评分>,
            "value_proposition": "<价值主张的详细描述>",
            "key_innovations": ["关键点1", "关键点2"],
            "target_industries": ["行业1", "行业2"]
          }
        `;

        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        if (!aiAssessment) {
          logMessages.push(`  -> AI评估失败，跳过此动态。`);
          updatesForRawSheet.push({ raw_id: dynamic.raw_id, status: 'failed', linkedId: '' });
          errorCount++;
          continue;
        }

        // 2. 计算信号强度
        const commercialValue = parseFloat(aiAssessment.commercial_value_score) || 0;
        const breakthroughScore = parseFloat(aiAssessment.breakthrough_score) || 0;
        const strategicImpact = parseFloat(aiAssessment.strategic_impact_score) || 0;
        
        // 信号强度加权计算，更侧重商业和战略影响
        const signalStrength = (commercialValue * 0.4) + (strategicImpact * 0.4) + (breakthroughScore * 0.2);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);

        // 3. 判断是否生成线索
        if (signalStrength >= 7.5) {
          newSignalsCount++;
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const intelligenceId = `TI${Utilities.formatDate(new Date(), 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceRecord = [
            intelligenceId,
            dynamic.tech_id || '', // 尝试关联tech_id
            dynamic.tech_keywords,
            dynamic.event_title,
            String(dynamic.event_summary).substring(0, 500),
            'industry_dynamics', // 触发源
            dynamic.source_url,
            wfName,
            signalStrength.toFixed(2),
            breakthroughScore.toFixed(2),
            commercialValue.toFixed(2),
            'medium', // confidence_level 初始值
            'high', // priority 初始值
            'signal_identified',
            `战略影响评分: ${strategicImpact.toFixed(1)}. ${aiAssessment.reasoning || ''}`,
            aiAssessment.value_proposition || "N/A",
            (aiAssessment.key_innovations || []).join(', '),
            (aiAssessment.target_industries || []).join(', '),
            1, 0, nowTimestamp, nowTimestamp, 'Raw_Industry_Dynamics', dynamic.raw_id
          ];
          newIntelligenceRecords.push(intelligenceRecord);
          updatesForRawSheet.push({ raw_id: dynamic.raw_id, status: 'processed', linkedId: intelligenceId });
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceId}`);
        } else {
          updatesForRawSheet.push({ raw_id: dynamic.raw_id, status: 'processed', linkedId: '' });
          logMessages.push(`  -> 低价值信号 (强度: ${signalStrength.toFixed(2)})，已归档。`);
        }
      }

      // 4. 批量写入和回填
      if (newIntelligenceRecords.length > 0) {
        intelSheet.getRange(intelSheet.getLastRow() + 1, 1, newIntelligenceRecords.length, newIntelligenceRecords[0].length).setValues(newIntelligenceRecords);
        logMessages.push(`成功写入 ${newIntelligenceRecords.length} 条新线索记录。`);
      }

      if (updatesForRawSheet.length > 0) {
        // 使用更健壮的回填逻辑
        const rawDataForUpdate = rawDynamicsSheet.getDataRange().getValues();
        const rawHeaders = rawDataForUpdate[0];
        const rawHeaderMap = rawHeaders.reduce((acc, h, i) => { acc[String(h).trim()] = i; return acc; }, {});
        
        const idCol = rawHeaderMap['raw_id'];
        const statusCol = rawHeaderMap['processing_status'];
        const linkedIdCol = rawHeaderMap['linked_intelligence_id'];

        if (typeof idCol === 'undefined' || typeof statusCol === 'undefined' || typeof linkedIdCol === 'undefined') {
            throw new Error("在 Raw_Industry_Dynamics 表中找不到关键列 (raw_id, processing_status, or linked_intelligence_id)。");
        }

        const updateMap = updatesForRawSheet.reduce((acc, u) => { acc[u.raw_id] = u; return acc; }, {});
        let changesMade = false;
        for (let i = 2; i < rawDataForUpdate.length; i++) { // 数据从第3行开始
            const rowId = rawDataForUpdate[i][idCol];
            if (rowId && updateMap[rowId]) {
                rawDataForUpdate[i][statusCol] = updateMap[rowId].status;
                rawDataForUpdate[i][linkedIdCol] = updateMap[rowId].linkedId;
                changesMade = true;
                delete updateMap[rowId];
            }
        }
        if (changesMade) {
            rawDynamicsSheet.getRange(1, 1, rawDataForUpdate.length, rawDataForUpdate[0].length).setValues(rawDataForUpdate);
            logMessages.push(`成功回填更新 ${updatesForRawSheet.length} 条原始记录的状态。`);
        }
      }
      
      const finalMessage = `处理了 ${processedCount} 条产业动态，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },
  runWf7_6Benchmark: function() {
    const wfName = 'WF7-6: 竞争线索信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_6_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allCompIntel = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE);
      const pendingIntel = allCompIntel.filter(item => item.processing_status && String(item.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingIntel.length} 条待处理的竞争线索记录。`);
      if (pendingIntel.length === 0) {
        const msg = "没有待处理的竞争线索记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const rawCompIntelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.RAWDATA_DB).getSheetByName(CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE);
      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      
      const newIntelligenceRecords = [];
      const updatesForRawSheet = [];

      for (const intel of pendingIntel) {
        processedCount++;
        logMessages.push(`正在处理竞情: ${intel.intelligence_title.substring(0, 50)}...`);

        // 1. 设计AI Prompt进行深度分析
        const prompt = `
          请作为一名资深的行业与竞争战略分析师，深入分析以下关于业绩标杆的新闻线索，并严格以JSON格式返回。
          
          新闻标题: ${intel.intelligence_title}
          新闻摘要: ${intel.intelligence_summary}
          涉及公司: ${intel.competitor_name}

          你需要完成以下任务:
          1. 评估此线索对我们的威胁等级 (threat_level_score)，评分1-10。
          2. 评估此线索对我们业务的潜在影响 (business_impact_score)，评分1-10。
          3. 总结此线索的核心价值主张 (value_proposition)，即它揭示了对手的何种战略意图、技术突破或市场动向。
          4. 提炼出这项线索中涉及的关键技术关键词 (tech_keywords)，以数组形式表示。
          5. 将此线索分类为以下类型之一：'Product Release', 'Tech Innovation', 'Talent Flow', 'Financial Report', 'Strategic Partnership', 'General News'。将结果放在 intelligence_type 字段。

          返回的 JSON 格式必须是:
          {
            "threat_level_score": <威胁等级评分>,
            "business_impact_score": <业务影响评分>,
            "value_proposition": "<对线索核心价值的精炼总结>",
            "tech_keywords": ["关键词1", "关键词2"],
            "intelligence_type": "<线索分类>"
          }
        `;

        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        if (!aiAssessment) {
          logMessages.push(`  -> AI评估失败，跳过此线索。`);
          updatesForRawSheet.push({ raw_id: intel.raw_id, status: 'failed', linkedId: '' });
          errorCount++;
          continue;
        }

        // 2. 计算信号强度
        const threatLevel = parseFloat(aiAssessment.threat_level_score) || 0;
        const businessImpact = parseFloat(aiAssessment.business_impact_score) || 0;
        
        // 信号强度加权计算
        const signalStrength = (threatLevel * 0.5) + (businessImpact * 0.5);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);

        // 3. 判断是否生成线索
        if (signalStrength >= 7.0) {
          newSignalsCount++;
          const nowTimestamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm:ss");
          const intelligenceId = `TI${Utilities.formatDate(new Date(), 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceRecord = [
            intelligenceId,
            '', // tech_id 留空，因为这是竞情，不直接关联技术
            (aiAssessment.tech_keywords || []).join(', '), // 从AI结果中获取技术关键词
            intel.intelligence_title,
            String(intel.intelligence_summary).substring(0, 500),
            'competitor_intelligence', // 触发源
            intel.source_url,
            wfName,
            signalStrength.toFixed(2),
            0, // breakthrough_score 设为0，或根据需要由AI评估
            businessImpact.toFixed(2), // commercial_value_score 用 business_impact_score 代替
            'medium', 
            'high',
            'signal_identified',
            `威胁等级评分: ${threatLevel.toFixed(1)}.`,
            aiAssessment.value_proposition || "N/A",
            (aiAssessment.key_innovations || ["N/A"]).join(', '), // key_innovations 可能不存在，提供默认值
            aiAssessment.target_industries ? (aiAssessment.target_industries || []).join(', ') : '',
            1, 0, nowTimestamp, nowTimestamp, 'Raw_Competitor_Intelligence', intel.raw_id
          ];
          newIntelligenceRecords.push(intelligenceRecord);
          updatesForRawSheet.push({ raw_id: intel.raw_id, status: 'processed', linkedId: intelligenceId, intelType: aiAssessment.intelligence_type, threat: threatLevel, impact: businessImpact });
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceId}`);
        } else {
          updatesForRawSheet.push({ raw_id: intel.raw_id, status: 'processed_low_value', linkedId: '', intelType: aiAssessment.intelligence_type, threat: threatLevel, impact: businessImpact });
          logMessages.push(`  -> 低价值信号 (强度: ${signalStrength.toFixed(2)})，已归档。`);
        }
      }

      // 4. 批量写入和回填
      if (newIntelligenceRecords.length > 0) {
        intelSheet.getRange(intelSheet.getLastRow() + 1, 1, newIntelligenceRecords.length, newIntelligenceRecords[0].length).setValues(newIntelligenceRecords);
        logMessages.push(`成功写入 ${newIntelligenceRecords.length} 条新线索记录。`);
      }

      if (updatesForRawSheet.length > 0) {
        const rawDataForUpdate = rawCompIntelSheet.getDataRange().getValues();
        const rawHeaders = rawDataForUpdate[0];
        const rawHeaderMap = rawHeaders.reduce((acc, h, i) => { acc[String(h).trim()] = i; return acc; }, {});
        
        const idCol = rawHeaderMap['raw_id'];
        const statusCol = rawHeaderMap['processing_status'];
        const linkedIdCol = rawHeaderMap['linked_intelligence_id'];
        const intelTypeCol = rawHeaderMap['intelligence_type'];
        const threatCol = rawHeaderMap['threat_level_score'];
        const impactCol = rawHeaderMap['business_impact_score'];

        if ([idCol, statusCol, linkedIdCol, intelTypeCol, threatCol, impactCol].some(c => typeof c === 'undefined')) {
            throw new Error("在 Raw_Competitor_Intelligence 表中找不到所有关键列。");
        }

        const updateMap = updatesForRawSheet.reduce((acc, u) => { acc[u.raw_id] = u; return acc; }, {});
        let changesMade = false;
        for (let i = 2; i < rawDataForUpdate.length; i++) {
            const rowId = rawDataForUpdate[i][idCol];
            if (rowId && updateMap[rowId]) {
                const update = updateMap[rowId];
                rawDataForUpdate[i][statusCol] = update.status;
                rawDataForUpdate[i][linkedIdCol] = update.linkedId;
                rawDataForUpdate[i][intelTypeCol] = update.intelType;
                rawDataForUpdate[i][threatCol] = update.threat.toFixed(1);
                rawDataForUpdate[i][impactCol] = update.impact.toFixed(1);
                changesMade = true;
                delete updateMap[rowId];
            }
        }
        if (changesMade) {
            rawCompIntelSheet.getRange(1, 1, rawDataForUpdate.length, rawDataForUpdate[0].length).setValues(rawDataForUpdate);
            logMessages.push(`成功回填更新 ${updatesForRawSheet.length} 条原始竞情记录的状态和评分。`);
        }
      }
      
      const finalMessage = `处理了 ${processedCount} 条竞争线索，生成了 ${newSignalsCount} 条新核心线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // =========================================================================
  //  第三层：统一证据验证 (WF8)
  // =========================================================================
  runWf8_EvidenceValidation: function() {
    const wfName = 'WF8: 统一证据验证';
    const startTime = new Date();
    const executionId = `exec_wf8_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0, verifiedCount = 0, rejectedCount = 0;

    try {
      const allIntelligences = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      const pendingIntels = allIntelligences.filter(row => String(row.processing_status || '').trim().toLowerCase() === 'signal_identified');
      
      logMessages.push(`发现 ${pendingIntels.length} 条待验证线索。`);
      if (pendingIntels.length === 0) {
        const msg = "没有待处理记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const intelSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      const validationSheet = SpreadsheetApp.openById(CONFIG.DATABASE_IDS.INTELLIGENCE_DB).getSheetByName(CONFIG.SHEET_NAMES.EVIDENCE_VALIDATION);
      const allIntelDataForUpdate = intelSheet.getDataRange().getValues();
      const headers = allIntelDataForUpdate[0];
      const headerMap = headers.reduce((acc, h, i) => { acc[String(h).trim()] = i; return acc; }, {});

      for (const intel of pendingIntels) {
        processedCount++;
        logMessages.push(`正在处理线索ID: ${intel.intelligence_id}`);

        let urlValidityStatus = 'invalid';
        if (intel.source_url && typeof intel.source_url === 'string' && intel.source_url.startsWith('http')) {
            try {
                const response = UrlFetchApp.fetch(intel.source_url, { method: 'head', muteHttpExceptions: true, followRedirects: true });
                if (response.getResponseCode() >= 200 && response.getResponseCode() < 400) urlValidityStatus = 'valid';
            } catch(e) {}
        }

        let sourceAuthorityScore = 5;
        if(intel.source_url) {
            const url = intel.source_url.toLowerCase();
            if (url.includes('arxiv') || url.includes('ieee')) sourceAuthorityScore = 9;
            else if (url.includes('techcrunch') || url.includes('mit.edu')) sourceAuthorityScore = 8;
        }
        
        const prompt = `
          请作为一名技术线索分析师，基于以下验证数据，为这条线索的整体可信度进行评分。
          评分标准为1-100的整数。
          请严格以 JSON 格式返回。

          线索标题: ${intel.title}
          链接有效性: ${urlValidityStatus}
          来源权威性评分 (1-10): ${sourceAuthorityScore}

          返回的 JSON 格式必须是:
          {
            "validation_confidence": <0-100之间的整数>,
            "reasoning": "<简要的评估理由>"
          }
        `;
        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });
        
        const validationConfidence = aiAssessment ? (parseInt(aiAssessment.validation_confidence) || 0) : 0;
        const validationNotes = aiAssessment ? aiAssessment.reasoning : "AI评估失败，无法生成理由。";

        let validationStatusInMatrix = 'rejected';
        let newIntelStatusInMaster = 'completed';

        if (validationConfidence >= 80) {
          validationStatusInMatrix = 'verified';
          newIntelStatusInMaster = 'analyzing';
          verifiedCount++;
        } else {
          rejectedCount++;
        }

        const validationId = `VAL_${intel.intelligence_id}`;
        const nowTimestamp = Utilities.formatDate(new Date(), 'UTC', 'yyyy-MM-dd HH:mm:ss');
        
        const validationRecord = [
          validationId || `VAL_ERR_${new Date().getTime()}`,
          intel.intelligence_id || '未知ID',
          intel.data_type || '未知类型',
          intel.source_url || '',
          urlValidityStatus,
          sourceAuthorityScore,
          0, 'no', 0,
          validationConfidence,
          0,
          validationStatusInMatrix,
          validationNotes,
          'system',
          nowTimestamp,
          nowTimestamp,
          nowTimestamp
        ];
        validationSheet.appendRow(validationRecord);

        for (let i = 2; i < allIntelDataForUpdate.length; i++) {
          if (allIntelDataForUpdate[i][headerMap['intelligence_id']] === intel.intelligence_id) {
            intelSheet.getRange(i + 1, headerMap['processing_status'] + 1).setValue(newIntelStatusInMaster);
            intelSheet.getRange(i + 1, headerMap['confidence_level'] + 1).setValue(validationConfidence);
            break;
          }
        }
      }

      const finalMessage = `处理了 ${processedCount} 条线索，通过验证 ${verifiedCount} 条，拒绝/待审 ${rejectedCount} 条。`;
      logMessages.push(`[${new Date().toLocaleTimeString()}] ${wfName} 执行成功。`);
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, verifiedCount, 0, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      logMessages.push(`[${new Date().toLocaleTimeString()}] ${errorMessage}`);
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, verifiedCount, 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },
  // =========================================================================
  //  第四层：深度分析工作流 (WF9 - WF11)
  // =========================================================================
  runWf9_CommercialValueAnalysis: function() { return { success: false, message: "WF9 功能尚未实现。", log: "WF9 功能尚未实现。" }; },
  runWf10_CompetitiveIntelAnalysis: function() { return { success: false, message: "WF10 功能尚未实现。", log: "WF10 功能尚未实现。" }; },
  runWf11_TechnicalDeepAnalysis: function() { return { success: false, message: "WF11 功能尚未实现。", log: "WF11 功能尚未实现。" }; },

  // =========================================================================
  //  第五层：决策支撑工作流 (WF12 - WF13)
  // =========================================================================
  runWf12_IntelligenceIntegration: function() { return { success: false, message: "WF12 功能尚未实现。", log: "WF12 功能尚未实现。" }; },
  runWf13_ReportGeneration: function() { return { success: false, message: "WF13 功能尚未实现。", log: "WF13 功能尚未实现。" }; },

  // =========================================================================
  //  第六层：监控维护工作流 (WF14 - WF15)
  // =========================================================================
  runWf14_DataQualityMonitor: function() { return { success: false, message: "WF14 功能尚未实现。", log: "WF14 功能尚未实现。" }; },
  runWf15_SystemHealthCheck: function() { return { success: false, message: "WF15 功能尚未实现。", log: "WF15 功能尚未实现。" }; },
};
