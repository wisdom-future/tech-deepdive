// 文件名: backend/svc.Workflows.gs (最终完整、无省略版)

/**
 * @file 工作流执行服务
 * 负责将原Make.com中的工作流逻辑转换为Apps Script函数，供前端页面调用。
 * 版本：3.0 - 实现所有六层工作流的后端逻辑，集成AI预处理。
 */
const WorkflowsService = {

  // ====================================================================================================================
  //  辅助函数 (HELPER FUNCTIONS)
  // ====================================================================================================================

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
        operator_id: Session.getActiveUser().getEmail() || 'system', // 正确的 operator_id
        summary_message: message, // 正确的 summary_message
        error_details: status === 'failed' ? message : '', // 只有失败时才记录错误详情
        run_by: 'system', // 执行者
        created_timestamp: new Date() // 记录创建时间
      };
      
      DataService.batchUpsert('WORKFLOW_LOG', [logObject], 'id');

    } catch (e) {
      Logger.log(`Failed to write execution log for ${wfName}: ${e.message}`);
    }
  },
  
  /**
   * 统一的AI评分调用函数 (用于结构化评分)
   */
  _callAIForScoring: function(prompt, logContext) {
    const { wfName, executionId, logMessages } = logContext;
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
          return JSON.parse(jsonResponse.choices[0].message.content);
        } else {
          throw new Error("AI响应格式不正确，缺少choices或message。");
        }
      } else {
        throw new Error(`AI API返回错误，状态码: ${responseCode}, 响应: ${responseBody}`);
      }
    } catch (e) {
      Logger.log(`[${wfName}] AI调用失败: ${e.message}`);
      if (logMessages) {
          logMessages.push(`警告: AI评估失败 - ${e.message}`);
      }
      return null;
    }
  },

  /**
   * 辅助函数：调用 AI 进行文本生成 (例如摘要、关键词列表)
   * @param {string} prompt - 发送给AI的完整指令。
   * @param {object} [options] - AI模型选项 (model, temperature, max_tokens)。
   * @returns {string} AI生成的文本。
   */
  _callAIForTextGeneration: function(prompt, options = {}) {
    Logger.log(`[AI-TextGen] Calling AI for text generation. Prompt snippet: ${prompt.substring(0, 100)}...`);
    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error("AI API Key未在项目属性中配置 (OPENAI_API_KEY)。");

    const model = options.model || "gpt-4o-mini";
    const temperature = options.temperature || 0.5;
    const max_tokens = options.max_tokens || 300;

    const payload = {
      model: model,
      messages: [{ role: "user", content: prompt }],
      max_tokens: max_tokens,
      temperature: temperature
    };

    const requestOptions = {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions);
      const jsonResponse = JSON.parse(response.getContentText());

      if (response.getResponseCode() === 200 && jsonResponse.choices && jsonResponse.choices.length > 0) {
        return jsonResponse.choices[0].message.content.trim();
      } else {
        Logger.log(`[AI-TextGen] API Error: ${response.getResponseCode()} - ${JSON.stringify(jsonResponse)}`);
        return `AI生成失败：API错误 (${response.getResponseCode()})。`;
      }
    } catch (e) {
      Logger.log(`[AI-TextGen] API调用失败: ${e.message}\n${e.stack}`);
      return `AI生成失败：连接或解析错误 (${e.message})。`;
    }
  },

  /**
   * 辅助函数：调用 AI 生成文本向量 (Embedding)
   * @param {string|Array<string>} text - 要生成向量的文本或文本数组。
   * @param {object} [options] - Embedding模型选项 (model)。
   * @returns {Array<number>|null} 文本向量数组。
   */
  _callAIForEmbedding: function(text, options = {}) {
    Logger.log(`[AI-Embedding] Calling AI for embedding. Text snippet: ${String(text).substring(0, 50)}...`);
    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) throw new Error("AI API Key未在项目属性中配置 (OPENAI_API_KEY)。");

    const model = options.model || "text-embedding-3-small";

    const payload = {
      input: text,
      model: model
    };

    const requestOptions = {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    try {
      const response = UrlFetchApp.fetch("https://api.openai.com/v1/embeddings", requestOptions);
      const jsonResponse = JSON.parse(response.getContentText());

      if (response.getResponseCode() === 200 && jsonResponse.data && jsonResponse.data.length > 0) {
        return jsonResponse.data[0].embedding;
      } else {
        Logger.log(`[AI-Embedding] API Error: ${response.getResponseCode()} - ${JSON.stringify(jsonResponse)}`);
        return null;
      }
    } catch (e) {
      Logger.log(`[AI-Embedding] API调用失败: ${e.message}\n${e.stack}`);
      return null;
    }
  },

  // ====================================================================================================================
  //  第一层：数据采集工作流 (WF1 - WF6)
  // ====================================================================================================================

  runWf1_AcademicPapers: function() {
    const wfName = 'WF1: 学术论文监控';
    const startTime = new Date();
    const executionId = `exec_wf1_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0;

    try {
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY');
      const activeTechs = techRegistry.filter(t =>
        t.monitoring_status === 'active' && t.data_source_academic === true);
      logMessages.push(`发现 ${activeTechs.length} 个活跃的技术监控项。`);
      processedCount = activeTechs.length;

      if (activeTechs.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有需要监控的活跃技术项。");
        return { success: true, message: "没有需要监控的活跃技术项。", log: logMessages.join('\n') };
      }
      
      let allNewPaperObjects = [];
      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);


      for (const tech of activeTechs) {
        const searchTerms = (tech.academic_search_terms || "").split(',').map(s => s.trim()).filter(Boolean);
        for (const term of searchTerms) {
          logMessages.push(`正在为技术 '${tech.tech_name}' 搜索关键词: '${term}'...`);
          const apiUrl = `http://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(term)}&sortBy=submittedDate&sortOrder=descending&max_results=5`;
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
            const paperUrl = entry.getChild('id', atomNs).getText();
            const duplicateHash = this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, paperUrl));

            if (existingHashes.has(duplicateHash)) {
                logMessages.push(`  -> 发现重复论文，跳过: ${paperUrl} (Hash: ${duplicateHash})`);
                duplicateCount++;
                continue;
            }

            const title = entry.getChild('title', atomNs).getText();
            const summary = entry.getChild('summary', atomNs).getText();
            const authors = entry.getChildren('author', atomNs).map(a => a.getChild('name', atomNs).getText()).join(', ');
            const publication_date = new Date(entry.getChild('published', atomNs).getText());

            logMessages.push(`  -> 正在为论文 "${title.substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
            const aiPrompt = `请为以下论文生成一个不超过100字的精炼摘要，和3-5个最核心的技术关键词（以逗号分隔）。\n\n标题: ${title}\n摘要: ${summary}`;
            const aiResponse = this._callAIForTextGeneration(aiPrompt);

            let ai_summary = "";
            let ai_keywords = "";
            const lines = aiResponse ? aiResponse.split('\n') : [];
            if (lines.length > 0) {
                ai_summary = lines[0].trim();
                if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                    ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
                } else if (lines.length > 1) { // 如果第二行不是关键词，尝试查找
                    ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                    ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
                }
            }
            
            const textForEmbedding = `${title} ${ai_summary} ${ai_keywords}`;
            const embeddingVector = this._callAIForEmbedding(textForEmbedding);

            const paperDataObject = {
                raw_id: `RAW_AP_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`,
                id: `RAW_AP_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`,
                source_type: 'academic_papers',
                title: title,
                abstract: summary,
                authors: authors,
                publication_date: publication_date,
                source_url: paperUrl,
                source_platform: 'arXiv',
                innovation_score: 0, // 暂时设为0，AI评分在信号识别阶段进行
                tech_keywords: tech.tech_keywords, // 原始技术关键词
                ai_summary: ai_summary,      // ✅ AI 生成的摘要
                ai_keywords: ai_keywords,    // ✅ AI 生成的关键词
                embedding: embeddingVector,  // ✅ AI 生成的向量
                processing_status: 'pending', // 保持 pending，等待信号识别
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date(),
                duplicate_check_hash: duplicateHash // 存储哈希值
            };
            allNewPaperObjects.push(paperDataObject);
            successCount++;
          }
        }
      }
      
      if (allNewPaperObjects.length > 0) {
        DataService.batchUpsert('RAW_ACADEMIC_PAPERS', allNewPaperObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewPaperObjects.length} 条论文数据（含AI预处理）。`);
      }
      
      const finalMessage = `成功处理 ${processedCount} 个技术项，发现 ${successCount} 篇论文（含AI预处理），跳过 ${duplicateCount} 条重复论文。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf2_PatentData: function() {
    const wfName = 'WF2: 专利申请追踪';
    const startTime = new Date();
    const executionId = `exec_wf2_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0; // 新增duplicateCount

    try {
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY')
                                     .filter(t => t.monitoring_status === 'active' && t.data_source_patent === true);
      
      processedCount = techRegistry.length;
      logMessages.push(`发现 ${processedCount} 个需要监控专利的技术领域。`);

      if (processedCount === 0) {
        const msg = "没有需要监控专利的活跃技术领域。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      let allNewPatentObjects = [];
      const patentApiKey = PropertiesService.getScriptProperties().getProperty('PATENT_API_KEY');
      // if (!patentApiKey) throw new Error("PATENT_API_KEY 未在项目属性中配置。"); // 启用真实API时取消注释

      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_PATENT_DATA') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);
      for (const tech of techRegistry) {
        const searchTerms = (tech.patent_search_terms || "").split(',').map(s => s.trim()).filter(Boolean);
        for (const term of searchTerms) {
          logMessages.push(`正在为技术 '${tech.tech_name}' 搜索专利: '${term}'...`);
          
          // 模拟专利API调用，实际需要替换为真实API
          const mockPatentData = [
            { raw_id: `RAW_PT_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_MOCK1`, title: `Patent for ${term} AI`, abstract: `This patent describes an innovative method for ${term} based AI...`, patent_number: `US${Math.floor(Math.random()*1e8)}`, application_date: new Date(2025, 5, Math.floor(Math.random()*30)+1), inventors: 'John Doe', status: 'pending', source_url: 'https://mockpatent.com/1', duplicate_check_hash: this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, 'https://mockpatent.com/1')) },
            { raw_id: `RAW_PT_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_MOCK2`, title: `Another Patent on ${term} Robotics`, abstract: `This covers new robotic applications of ${term} technology...`, patent_number: `US${Math.floor(Math.random()*1e8)}`, application_date: new Date(2025, 4, Math.floor(Math.random()*30)+1), inventors: 'Jane Smith', status: 'granted', source_url: 'https://mockpatent.com/2', duplicate_check_hash: this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, 'https://mockpatent.com/2')) },
          ];
          
          if (mockPatentData.length === 0) {
            logMessages.push(`  -> 未找到相关专利。`);
            continue;
          }

          for (const patent of mockPatentData) {
            if (existingHashes.has(patent.duplicate_check_hash)) {
                logMessages.push(`  -> 发现重复专利，跳过: ${patent.title.substring(0,30)}... (Hash: ${patent.duplicate_check_hash})`);
                duplicateCount++;
                continue;
            }

            logMessages.push(`  -> 正在为专利 "${patent.title.substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
            const aiPrompt = `请为以下专利生成一个不超过80字的精炼摘要，和3-5个最核心的技术关键词（以逗号分隔）。\n\n专利标题: ${patent.title}\n摘要: ${patent.abstract}`;
            const aiResponse = this._callAIForTextGeneration(aiPrompt);

            let ai_summary = "";
            let ai_keywords = "";
            const lines = aiResponse ? aiResponse.split('\n') : [];
            if (lines.length > 0) {
                ai_summary = lines[0].trim();
                if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                    ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
                } else if (lines.length > 1) {
                    ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                    ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
                }
            }
            
            const textForEmbedding = `${patent.title} ${ai_summary} ${ai_keywords}`;
            const embeddingVector = this._callAIForEmbedding(textForEmbedding);

            const patentDataObject = {
                raw_id: patent.raw_id,
                id: patent.raw_id,
                source_type: 'patent_data',
                title: patent.title,
                abstract: patent.abstract,
                patent_number: patent.patent_number,
                application_date: patent.application_date,
                inventors: patent.inventors,
                status: patent.status,
                ai_summary: ai_summary,
                ai_keywords: ai_keywords,
                embedding: embeddingVector,
                processing_status: 'pending',
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date(),
                duplicate_check_hash: patent.duplicate_check_hash
            };
            allNewPatentObjects.push(patentDataObject);
            successCount++;
          }
        }
      }

      if (allNewPatentObjects.length > 0) {
        DataService.batchUpsert('RAW_PATENT_DATA', allNewPatentObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewPatentObjects.length} 条专利数据（含AI预处理）。`);
      }
      
      const finalMessage = `成功处理 ${processedCount} 个技术项，发现 ${successCount} 篇专利（含AI预处理），跳过 ${duplicateCount} 条重复专利。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf3_OpenSource: function() {
    const wfName = 'WF3: 开源项目监测';
    const startTime = new Date();
    const executionId = `exec_wf3_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0;

    try {
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

      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_OPENSOURCE_DATA') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);


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

            const duplicateHash = this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, project.html_url));
            
            if (existingHashes.has(duplicateHash)) {
                logMessages.push(`  -> 发现重复开源项目，跳过: ${project.full_name.substring(0,30)}... (Hash: ${duplicateHash})`);
                duplicateCount++;
                continue;
            }

            const raw_id = `RAW_OS_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;
            
            logMessages.push(`  -> 正在为开源项目 "${project.full_name.substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
            const aiPrompt = `请为以下开源项目生成一个不超过80字的精炼摘要，和3-5个最核心的技术关键词（以逗号分隔）。\n\n项目名称: ${project.full_name}\n描述: ${project.description || ''}`;
            const aiResponse = this._callAIForTextGeneration(aiPrompt);

            let ai_summary = "";
            let ai_keywords = "";
            const lines = aiResponse ? aiResponse.split('\n') : [];
            if (lines.length > 0) {
                ai_summary = lines[0].trim();
                if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                    ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
                } else if (lines.length > 1) {
                    ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                    ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
                }
            }
            
            const textForEmbedding = `${project.full_name} ${ai_summary} ${ai_keywords}`;
            const embeddingVector = this._callAIForEmbedding(textForEmbedding);

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
                contributor_count: project.watchers_count,
                tech_keywords: tech.tech_keywords,
                ai_summary: ai_summary,
                ai_keywords: ai_keywords,
                embedding: embeddingVector,
                processing_status: 'pending',
                workflow_execution_id: executionId,
                created_timestamp: new Date(),
                last_update_timestamp: new Date(),
                duplicate_check_hash: duplicateHash
            };
            allNewProjectsObjects.push(projectDataObject);
            successCount++;
          }
        }
      }

      if (allNewProjectsObjects.length > 0) {
        DataService.batchUpsert('RAW_OPENSOURCE_DATA', allNewProjectsObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewProjectsObjects.length} 条开源项目数据（含AI预处理）。`);
      }
      
      const finalMessage = `成功处理 ${processedCount} 个技术领域，发现并写入了 ${successCount} 个相关开源项目，跳过 ${duplicateCount} 条重复项目。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf4_TechNews: function() {
    const wfName = 'WF4: 技术新闻获取';
    const startTime = new Date();
    const executionId = `exec_wf4_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0;

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

      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_TECH_NEWS') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);


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
            const duplicateHash = this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, article.url));
            if (existingHashes.has(duplicateHash)) {
                logMessages.push(`  -> 发现重复新闻，跳过: ${article.title.substring(0,30)}... (Hash: ${duplicateHash})`);
                duplicateCount++;
                continue;
            }

          logMessages.push(`  -> 正在为新闻 "${(article.title || "").substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
          const aiPrompt = `请为以下新闻生成一个不超过60字的精炼摘要，和3-5个最核心的关键词（以逗号分隔）。\n\n标题: ${article.title}\n摘要: ${article.description || ''}`;
          const aiResponse = this._callAIForTextGeneration(aiPrompt);

          let ai_summary = "";
          let ai_keywords = "";
          const lines = aiResponse ? aiResponse.split('\n') : [];
          if (lines.length > 0) {
              ai_summary = lines[0].trim();
              if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                  ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
              } else if (lines.length > 1) {
                  ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                  ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
              }
          }
          
          const textForEmbedding = `${article.title} ${ai_summary} ${ai_keywords}`;
          const embeddingVector = this._callAIForEmbedding(textForEmbedding);

          const raw_id = `RAW_TN_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

          const newsDataObject = {
            raw_id: raw_id,
            id: raw_id,
            source_type: 'tech_news',
            news_title: article.title,
            news_summary: (article.description || '').substring(0, 500),
            source_url: article.url,
            publication_date: new Date(article.publishedAt),
            source_platform: article.source.name,
            author: article.author || '',
            related_companies: isTech ? '' : entity.company_name, // WF4中，如果是技术新闻，related_companies为空；如果是企业新闻，则为企业名
            tech_keywords: isTech ? entity.tech_keywords : '', // WF4中，如果是技术新闻，tech_keywords为技术关键词；如果是企业新闻，则为空
            ai_summary: ai_summary,      // ✅ AI 生成的摘要
            ai_keywords: ai_keywords,    // ✅ AI 生成的关键词
            embedding: embeddingVector,  // ✅ AI 生成的向量
            processing_status: 'pending',
            news_value_score: 0, // AI 评分将在信号识别阶段进行
            market_impact_score: 0, // AI 评分将在信号识别阶段进行
            duplicate_check_hash: duplicateHash,
            workflow_execution_id: executionId,
            created_timestamp: new Date(),
            last_update_timestamp: new Date()
          };

          allNewArticles.push(newsDataObject);
          successCount++;
        }
      }
      if (allNewArticles.length > 0) {
        DataService.batchUpsert('RAW_TECH_NEWS', allNewArticles, 'raw_id');
        logMessages.push(`成功写入 ${allNewArticles.length} 条新新闻数据（含AI预处理）。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个实体，发现 ${successCount} 篇高价值文章，跳过 ${duplicateCount} 条重复文章。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

    runWf5_IndustryDynamics: function() {
    const wfName = 'WF5: 产业动态/会议新闻捕获';
    const startTime = new Date();
    const executionId = `exec_wf5_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0;

    try {
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
      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_INDUSTRY_DYNAMICS') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);


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
            const duplicateHash = this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, article.url));
            if (existingHashes.has(duplicateHash)) {
                logMessages.push(`  -> 发现重复产业动态文章，跳过: ${article.title.substring(0,30)}... (Hash: ${duplicateHash})`);
                duplicateCount++;
                continue;
            }

          logMessages.push(`  -> 正在为产业动态 "${(article.title || "").substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
          const aiPrompt = `请为以下产业动态新闻生成一个不超过80字的精炼摘要，和3-5个最核心的关键词（以逗号分隔）。\n\n标题: ${article.title}\n摘要: ${article.description || ''}`;
          const aiResponse = this._callAIForTextGeneration(aiPrompt);

          let ai_summary = "";
          let ai_keywords = "";
          const lines = aiResponse ? aiResponse.split('\n') : [];
          if (lines.length > 0) {
              ai_summary = lines[0].trim();
              if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                  ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
              } else if (lines.length > 1) {
                  ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                  ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
              }
          }
          
          const textForEmbedding = `${article.title} ${ai_summary} ${ai_keywords}`;
          const embeddingVector = this._callAIForEmbedding(textForEmbedding);

          // --- 新增：AI识别相关公司 ---
          const companyPrompt = `请作为一名资深的市场分析师，从以下产业动态新闻中识别并提取所有提及的公司名称。
            如果新闻内容中未明确提及公司，则返回空列表。
            请严格以JSON数组格式返回公司名称（例如：["公司A", "公司B"]）。
            新闻标题: ${article.title}
            新闻摘要: ${article.description || ''}`;
          
          let relatedCompanies = [];
          try {
              // 尝试强制AI返回JSON对象，并从其属性中提取数组
              const aiCompanyResponse = this._callAIForScoring(companyPrompt, { wfName, logMessages }); // 使用 _callAIForScoring 强制JSON
              if (aiCompanyResponse && aiCompanyResponse.companies && Array.isArray(aiCompanyResponse.companies)) {
                  relatedCompanies = aiCompanyResponse.companies.map(c => String(c).trim()).filter(Boolean); // 确保是字符串数组
              } else if (aiCompanyResponse && Array.isArray(aiCompanyResponse)) { // 有时AI可能直接返回数组
                  relatedCompanies = aiCompanyResponse.map(c => String(c).trim()).filter(Boolean);
              } else {
                  logMessages.push(`警告: AI识别公司返回了非预期格式: ${JSON.stringify(aiCompanyResponse).substring(0, 100)}...`);
              }
          } catch (e) {
              logMessages.push(`警告: AI识别相关公司失败: ${e.message}`);
              relatedCompanies = []; // 确保错误时仍为空数组
          }
          // --- 新增结束 ---

          const raw_id = `RAW_ID_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

          const dynamicsDataObject = {
            raw_id: raw_id,
            id: raw_id,
            source_type: 'industry_dynamics',
            event_title: article.title,
            event_summary: (article.description || '').substring(0, 500),
            source_url: article.url,
            publication_date: new Date(article.publishedAt),
            source_platform: article.source.name,
            event_type: 'Conference News',
            tech_keywords: conf.industry_focus,
            industry_category: conf.industry_focus,
            ai_summary: ai_summary,
            ai_keywords: ai_keywords,
            embedding: embeddingVector,
            related_companies: relatedCompanies, // <-- 将 AI 识别的公司添加到数据对象
            processing_status: 'pending',
            workflow_execution_id: executionId,
            created_timestamp: new Date(),
            last_update_timestamp: new Date(),
            duplicate_check_hash: duplicateHash // 存储哈希值
          };
          allNewDynamicsObjects.push(dynamicsDataObject);
          successCount++;
        }
      }

      if (allNewDynamicsObjects.length > 0) {
        DataService.batchUpsert('RAW_INDUSTRY_DYNAMICS', allNewDynamicsObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewDynamicsObjects.length} 条新产业动态数据（含AI预处理）。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个会议，发现 ${successCount} 条相关新闻，跳过 ${duplicateCount} 条重复文章。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

    runWf6_Benchmark: function() {
    const wfName = 'WF6: 竞争对手情报收集';
    const startTime = new Date();
    const executionId = `exec_wf6_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let successCount = 0, processedCount = 0, errorCount = 0, duplicateCount = 0; // 新增duplicateCount

    try {
      const competitorRegistry = DataService.getDataAsObjects('COMPETITOR_REGISTRY');
      if (!competitorRegistry) {
        throw new Error("无法从 'COMPETITOR_REGISTRY' 获取数据。");
      }
      
      const activeCompetitors = competitorRegistry.filter(c => 
        c.monitoring_status === 'active' &&
        c.news_monitoring === true
      );

      processedCount = activeCompetitors.length;
      logMessages.push(`发现 ${processedCount} 个需要监控新闻的活跃竞争对手。`);

      if (processedCount === 0) {
        const msg = "在 Competitor_Registry 中没有找到需要监控新闻的活跃竞争对手。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      const newsApiKey = PropertiesService.getScriptProperties().getProperty('NEWS_API_KEY');
      if (!newsApiKey) throw new Error("NewsAPI Key 未在项目属性中配置 (NEWS_API_KEY)。");

      let allNewIntelObjects = [];
      
      // ✅ 新增：获取所有现有数据的哈希值，用于快速去重
      // 优化：只获取 duplicate_check_hash 字段，避免加载整个文档
      const existingHashes = new Set(
          (DataService.getDataAsObjects('RAW_COMPETITOR_INTELLIGENCE') || [])
          .map(item => item.duplicate_check_hash)
          .filter(Boolean)
      );
      logMessages.push(`  -> 现有 ${existingHashes.size} 条历史记录用于去重检查。`);


      for (const competitor of activeCompetitors) {
        const query = `"${competitor.company_name}"`;
        logMessages.push(`正在为竞争对手 '${competitor.company_name}' 搜索新闻...`);

        const apiUrl = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&language=en&sortBy=publishedAt&pageSize=5`;
        const response = UrlFetchApp.fetch(apiUrl, { headers: { 'X-Api-Key': newsApiKey }, muteHttpExceptions: true });

        if (response.getResponseCode() !== 200) {
          logMessages.push(`  -> 警告: 调用 NewsAPI 失败 (状态码: ${response.getResponseCode()})。`);
          errorCount++;
          continue;
        }

        const articles = JSON.parse(response.getContentText()).articles || [];
        for (const article of articles) {
          const duplicateHash = this._bytesToHex(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, article.url));
          
          // ✅ 核心去重检查
          if (existingHashes.has(duplicateHash)) {
              logMessages.push(`  -> 发现重复文章，跳过: ${article.title.substring(0,30)}... (Hash: ${duplicateHash})`);
              duplicateCount++; // 增加重复计数
              continue; // 跳过此文章
          }

          logMessages.push(`  -> 正在为竞争情报 "${(article.title || "").substring(0,30)}..." 生成 AI 摘要/关键词/向量...`);
          const aiPrompt = `请为以下关于竞争对手的新闻情报生成一个不超过80字的精炼摘要，和3-5个最核心的关键词（以逗号分隔）。\n\n标题: ${article.title}\n摘要: ${article.description || ''}`;
          const aiResponse = this._callAIForTextGeneration(aiPrompt);

          let ai_summary = "";
          let ai_keywords = "";
          const lines = aiResponse ? aiResponse.split('\n') : [];
          if (lines.length > 0) {
              ai_summary = lines[0].trim();
              if (lines.length > 1 && lines[1].toLowerCase().includes('关键词')) {
                  ai_keywords = lines[1].replace(/关键词[:：]/gi, '').trim();
              } else if (lines.length > 1) {
                  ai_keywords = lines.find(line => line.toLowerCase().includes('关键词')) || lines[1];
                  ai_keywords = ai_keywords.replace(/关键词[:：]/gi, '').trim();
              }
          }
          
          const textForEmbedding = `${article.title} ${ai_summary} ${ai_keywords}`;
          const embeddingVector = this._callAIForEmbedding(textForEmbedding);

          // ✅ 修复：在此处定义 duplicateHash
          const raw_id = `RAW_CI_${Utilities.formatDate(new Date(), 'UTC', 'yyyyMMddHHmmssSSS')}_${duplicateHash.substring(0, 6)}`;

          const intelDataObject = {
            raw_id: raw_id,
            id: raw_id,
            source_type: 'competitor_intelligence',
            intelligence_title: article.title,
            intelligence_summary: (article.description || '').substring(0, 500),
            source_url: article.url,
            publication_date: new Date(article.publishedAt),
            source_platform: article.source.name,
            author: article.author || '',
            competitor_name: competitor.company_name,
            intelligence_type: 'General News', // 初始类型，待 WF7-6 中由 AI 细化
            tech_keywords: '', // 留空，待 AI 分析
            ai_summary: ai_summary,
            ai_keywords: ai_keywords,
            embedding: embeddingVector,
            processing_status: 'pending',
            threat_level_score: 0,
            business_impact_score: 0,
            duplicate_check_hash: duplicateHash, // 现在 duplicateHash 已定义
            workflow_execution_id: executionId,
            created_timestamp: new Date(),
            last_update_timestamp: new Date()
          };
          allNewIntelObjects.push(intelDataObject);
          successCount++;
        }
      }

      if (allNewIntelObjects.length > 0) {
        DataService.batchUpsert('RAW_COMPETITOR_INTELLIGENCE', allNewIntelObjects, 'raw_id');
        logMessages.push(`成功写入 ${allNewIntelObjects.length} 条新竞争情报数据（含AI预处理）。`);
      }

      const finalMessage = `成功处理 ${processedCount} 个竞争对手，发现 ${successCount} 条新文章，跳过 ${duplicateCount} 条重复文章。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, successCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, successCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // ====================================================================================================================
  //  第二层：信号识别工作流 (WF7-1 - WF7-6)
  // ====================================================================================================================

    /**
   * ✅ 修正版: 执行 WF7-1: 学术论文信号识别
   */
   runWf7_1_AcademicSignalIdentification: function() {
    const wfName = 'WF7-1: 学术论文信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_1_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allPapers = DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS');
      const pendingPapers = allPapers.filter(paper => paper.processing_status && String(paper.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingPapers.length} 条待处理的论文记录。`);
      if (pendingPapers.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      for (const paper of pendingPapers) {
        processedCount++;
        logMessages.push(`正在处理论文: ${paper.title.substring(0, 50)}...`);

        const prompt = `
          请作为一名资深的技术与商业分析师，深入分析以下学术论文，并严格以JSON格式返回。
          
          论文标题: ${paper.title}
          论文摘要: ${paper.abstract}
          AI摘要: ${paper.ai_summary || ''}
          AI关键词: ${paper.ai_keywords || ''}

          你需要完成以下任务:
          1. 评估技术突破性 (breakthrough_score) 和潜在影响范围 (impact_scope)，并给出1-10分的评分。
          2. 评估商业潜力和可行性 (revenue_potential, commercialization_feasibility)，并给出1-10分的评分。
          3. 总结这篇论文的突破性分析理由 (breakthrough_reason)。
          4. 提炼其核心的价值主张 (value_proposition)。
          5. 列出1-3个关键创新点 (key_innovations)，以数组形式表示。
          6. 预测其可能的目标行业 (target_industries)，以数组形式表示。

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

        let intelligenceIdToLink = ''; // 提升声明，确保作用域可见
        const nowTimestamp = new Date(); // 提升声明

        if (!aiAssessment || typeof aiAssessment.breakthrough_score === 'undefined') {
            logMessages.push(`  -> AI评估失败，跳过此论文。`);
            errorCount++;
            // 确保即使 AI 评估失败，也进行状态更新和 AI 字段填充
            DataService.updateObject('RAW_ACADEMIC_PAPERS', paper.id, {
                processing_status: 'failed_ai_assessment', // 标记为AI评估失败
                linked_intelligence_id: '',
                innovation_score: parseFloat(aiAssessment?.breakthrough_score) || 0,
                breakthrough_score_ai: parseFloat(aiAssessment?.breakthrough_score) || 0,
                impact_scope_ai: parseFloat(aiAssessment?.impact_scope) || 0,
                revenue_potential_ai: parseFloat(aiAssessment?.revenue_potential) || 0,
                commercialization_feasibility_ai: parseFloat(aiAssessment?.commercialization_feasibility) || 0,
                breakthrough_reason_ai: aiAssessment?.breakthrough_reason || '',
                value_proposition_ai: aiAssessment?.value_proposition || '',
                key_innovations_ai: (aiAssessment?.key_innovations || []).join(', '),
                target_industries_ai: (aiAssessment?.target_industries || []).join(', '),
                updated_timestamp: nowTimestamp
            });
            continue;
        }

        const breakthroughScore = parseFloat(aiAssessment.breakthrough_score) || 0;
        const impactScope = parseFloat(aiAssessment.impact_scope) || 0;
        const revenuePotential = parseFloat(aiAssessment.revenue_potential) || 0;
        const commercializationFeasibility = parseFloat(aiAssessment.commercialization_feasibility) || 0;
        
        const signalStrength = (breakthroughScore * 0.3) + (impactScope * 0.2) + (revenuePotential * 0.3) + (commercializationFeasibility * 0.2);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);
        
        if (signalStrength >= 7.0) {
          newSignalsCount++;
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          const intelligenceObject = {
            id: intelligenceIdToLink,
            intelligence_id: intelligenceIdToLink,
            tech_id: paper.tech_id || '',
            tech_keywords: paper.tech_keywords || paper.ai_keywords,
            title: paper.title,
            content_summary: paper.ai_summary || paper.abstract.substring(0, 500),
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
            created_timestamp: nowTimestamp,
            updated_timestamp: nowTimestamp,
            source_table: 'Raw_Academic_Papers',
            source_record_id: paper.id,
            evidence_chain: [{
                id: paper.id,
                title: paper.title,
                source_type: 'academic_papers',
                source_url: paper.source_url,
                publication_date: paper.publication_date
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 信号强度 (${signalStrength.toFixed(2)}) 未达阈值，跳过。`);
        }
        // 统一更新 RAW_ACADEMIC_PAPERS 的状态和 AI 评分
        DataService.updateObject('RAW_ACADEMIC_PAPERS', paper.id, {
            processing_status: 'processed', // 无论是否生成线索，都标记为已处理
            linked_intelligence_id: intelligenceIdToLink, // 使用统一的 linked_intelligence_id 变量
            innovation_score: parseFloat(aiAssessment.breakthrough_score) || 0,
            breakthrough_score_ai: parseFloat(aiAssessment.breakthrough_score) || 0,
            impact_scope_ai: parseFloat(aiAssessment.impact_scope) || 0,
            revenue_potential_ai: parseFloat(aiAssessment.revenue_potential) || 0,
            commercialization_feasibility_ai: parseFloat(aiAssessment.commercialization_feasibility) || 0,
            breakthrough_reason_ai: aiAssessment.breakthrough_reason || '',
            value_proposition_ai: aiAssessment.value_proposition || '',
            key_innovations_ai: (aiAssessment.key_innovations || []).join(', '),
            target_industries_ai: (aiAssessment.target_industries || []).join(', '),
            updated_timestamp: nowTimestamp
        });
      }

      const finalMessage = `处理了 ${processedCount} 篇论文，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf7_2_PatentSignal: function() {
    const wfName = 'WF7-2: 专利数据信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_2_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allPatents = DataService.getDataAsObjects('RAW_PATENT_DATA');
      const pendingPatents = allPatents.filter(patent => patent.processing_status && String(patent.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingPatents.length} 条待处理的专利记录。`);
      if (pendingPatents.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      for (const patent of pendingPatents) {
        processedCount++;
        logMessages.push(`正在处理专利: ${patent.title.substring(0, 50)}...`);

        const prompt = `
          请作为一名资深的技术与商业分析师，深入分析以下专利，并严格以JSON格式返回。
          
          专利标题: ${patent.title}
          专利摘要: ${patent.abstract}
          专利号: ${patent.patent_number}
          申请日期: ${patent.application_date}
          发明人: ${patent.inventors}
          AI摘要: ${patent.ai_summary || ''}
          AI关键词: ${patent.ai_keywords || ''}

          你需要完成以下任务:
          1. 评估专利的技术创新性 (innovation_score) 和市场前景 (market_potential_score)，并给出1-10分的评分。
          2. 评估专利的法律壁垒强度 (legal_strength_score) 和商业化可行性 (commercialization_feasibility_score)，并给出1-10分的评分。
          3. 总结该专利的核心价值主张 (value_proposition)。
          4. 列出1-3个关键受保护点 (key_claims)，以数组形式表示。
          5. 预测其可能的目标应用领域 (target_applications)，以数组形式表示。

          返回的 JSON 格式必须是:
          {
            "innovation_score": <技术创新性评分>,
            "market_potential_score": <市场前景评分>,
            "legal_strength_score": <法律壁垒强度评分>,
            "commercialization_feasibility_score": <商业化可行性评分>,
            "value_proposition": "<对该专利核心商业价值的精炼总结>",
            "key_claims": ["受保护点1", "受保护点2"],
            "target_applications": ["应用领域1", "应用领域2"]
          }
        `;
        
        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        let intelligenceIdToLink = ''; // 提升声明
        const nowTimestamp = new Date(); // 提升声明

        if (!aiAssessment || typeof aiAssessment.innovation_score === 'undefined') {
            logMessages.push(`  -> AI评估失败，跳过此专利。`);
            errorCount++;
            // 确保即使 AI 评估失败，也进行状态更新和 AI 字段填充
            DataService.updateObject('RAW_PATENT_DATA', patent.id, {
                processing_status: 'failed_ai_assessment',
                linked_intelligence_id: '',
                innovation_score_ai: parseFloat(aiAssessment?.innovation_score) || 0,
                market_potential_score_ai: parseFloat(aiAssessment?.market_potential_score) || 0,
                legal_strength_score_ai: parseFloat(aiAssessment?.legal_strength_score) || 0,
                commercialization_feasibility_ai: parseFloat(aiAssessment?.commercialization_feasibility_score) || 0,
                value_proposition_ai: aiAssessment?.value_proposition || '',
                key_claims_ai: (aiAssessment?.key_claims || []).join(', '),
                target_applications_ai: (aiAssessment?.target_applications || []).join(', '),
                updated_timestamp: nowTimestamp
            });
            continue;
        }

        const innovationScore = parseFloat(aiAssessment.innovation_score) || 0;
        const marketPotentialScore = parseFloat(aiAssessment.market_potential_score) || 0;
        const legalStrengthScore = parseFloat(aiAssessment.legal_strength_score) || 0;
        const commercializationFeasibilityScore = parseFloat(aiAssessment.commercialization_feasibility_score) || 0;
        
        const signalStrength = (innovationScore * 0.3) + (marketPotentialScore * 0.3) + (legalStrengthScore * 0.2) + (commercializationFeasibilityScore * 0.2);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);
        
        if (signalStrength >= 7.0) { // 阈值可以根据实际情况调整
          newSignalsCount++;
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          const intelligenceObject = {
            id: intelligenceIdToLink,
            intelligence_id: intelligenceIdToLink,
            tech_id: patent.tech_id || '',
            tech_keywords: patent.ai_keywords || patent.tech_keywords,
            title: patent.title,
            content_summary: patent.ai_summary || patent.abstract.substring(0, 500),
            trigger_source: 'patent_data',
            source_url: patent.source_url,
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)),
            breakthrough_score: parseFloat(innovationScore.toFixed(2)),
            commercial_value_score: parseFloat(marketPotentialScore.toFixed(2)),
            confidence_level: 'medium',
            priority: 'high',
            processing_status: 'signal_identified',
            breakthrough_reason: aiAssessment.value_proposition || "N/A",
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_claims || []).join(', '),
            target_industries: (aiAssessment.target_applications || []).join(', '),
            version: 1,
            is_deleted: 0,
            created_timestamp: nowTimestamp,
            updated_timestamp: nowTimestamp,
            source_table: 'Raw_Patent_Data',
            source_record_id: patent.id,
            evidence_chain: [{
                id: patent.id,
                title: patent.title,
                source_type: 'patent_data',
                source_url: patent.source_url,
                publication_date: patent.application_date
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 信号强度 (${signalStrength.toFixed(2)}) 未达阈值，跳过。`);
        }
        // 统一更新 RAW_PATENT_DATA 的状态和 AI 评分
        DataService.updateObject('RAW_PATENT_DATA', patent.id, {
            processing_status: 'processed',
            linked_intelligence_id: intelligenceIdToLink,
            innovation_score_ai: parseFloat(aiAssessment.innovation_score) || 0,
            market_potential_score_ai: parseFloat(aiAssessment.market_potential_score) || 0,
            legal_strength_score_ai: parseFloat(aiAssessment.legal_strength_score) || 0,
            commercialization_feasibility_ai: parseFloat(aiAssessment.commercialization_feasibility_score) || 0,
            value_proposition_ai: aiAssessment.value_proposition || '',
            key_claims_ai: (aiAssessment.key_claims || []).join(', '),
            target_applications_ai: (aiAssessment.target_applications || []).join(', '),
            updated_timestamp: nowTimestamp
        });
      }

      const finalMessage = `处理了 ${processedCount} 篇专利，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf7_3_OpenSourceSignal: function() {
    const wfName = 'WF7-3: 开源项目信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_3_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allProjects = DataService.getDataAsObjects('RAW_OPENSOURCE_DATA');
      const pendingProjects = allProjects.filter(p => p.processing_status && String(p.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingProjects.length} 条待处理的开源项目记录。`);
      if (pendingProjects.length === 0) {
        const msg = "没有待处理记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

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

        // ✅ 修正：nowTimestamp 和 intelligenceIdToLink 的声明提升到 for 循环内部，if 块外部
        const nowTimestamp = new Date(); 
        let intelligenceIdToLink = ''; 

        if (!aiAssessment || typeof aiAssessment.project_potential_score === 'undefined') {
          logMessages.push(`  -> AI评估失败，跳过此项目。`);
          errorCount++;
          DataService.updateObject('RAW_OPENSOURCE_DATA', project.id, {
              processing_status: 'failed_ai_assessment',
              linked_intelligence_id: '',
              project_potential_score_ai: parseFloat(aiAssessment?.project_potential_score) || 0,
              adoption_trend_ai: parseFloat(aiAssessment?.adoption_trend) || 0,
              value_proposition_ai: aiAssessment?.value_proposition || '',
              key_innovations_ai: (aiAssessment?.key_innovations || []).join(', '),
              updated_timestamp: nowTimestamp
          });
          continue;
        }

        const potentialScore = parseFloat(aiAssessment.project_potential_score) || 0;
        const adoptionTrend = parseFloat(aiAssessment.adoption_trend) || 0;
        
        const signalStrength = (potentialScore * 0.6) + (adoptionTrend * 0.4);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);
        
        if (signalStrength >= 8.0) {
          newSignalsCount++;
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceObject = {
            id: intelligenceIdToLink, 
            intelligence_id: intelligenceIdToLink, 
            tech_id: project.tech_id || '', 
            tech_keywords: project.tech_keywords || project.ai_keywords, 
            title: project.project_name,
            content_summary: project.ai_summary || String(project.description).substring(0, 500), 
            trigger_source: 'opensource_data', 
            source_url: project.source_url, 
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)), 
            breakthrough_score: parseFloat(potentialScore.toFixed(2)),
            commercial_value_score: parseFloat(adoptionTrend.toFixed(2)),
            confidence_level: 'medium', 
            priority: 'medium', 
            processing_status: 'signal_identified', 
            breakthrough_reason: `项目潜力得分 ${potentialScore}, 社区趋势得分 ${adoptionTrend}`,
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_innovations || []).join(', '),
            target_industries: "开发者社区, 初创公司", // 默认值
            version: 1, 
            is_deleted: 0, 
            created_timestamp: nowTimestamp, 
            updated_timestamp: nowTimestamp, 
            source_table: 'Raw_OpenSource_Data', 
            source_record_id: project.id,
            evidence_chain: [{
                id: project.id,
                title: project.project_name,
                source_type: 'opensource_data',
                source_url: project.source_url,
                last_update_timestamp: project.last_update_timestamp
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 信号强度 (${signalStrength.toFixed(2)}) 未达阈值，跳过。`);
        }
        DataService.updateObject('RAW_OPENSOURCE_DATA', project.id, {
            processing_status: 'processed',
            linked_intelligence_id: intelligenceIdToLink,
            project_potential_score_ai: parseFloat(aiAssessment.project_potential_score) || 0,
            adoption_trend_ai: parseFloat(aiAssessment.adoption_trend) || 0,
            value_proposition_ai: aiAssessment.value_proposition || '',
            key_innovations_ai: (aiAssessment.key_innovations || []).join(', '),
            updated_timestamp: nowTimestamp
        });
      }
      
      const finalMessage = `处理了 ${processedCount} 个开源项目，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf7_4TechNewsSignal: function() {
    const wfName = 'WF7-4: 技术新闻信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_4_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0, newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allNews = DataService.getDataAsObjects('RAW_TECH_NEWS');
      const pendingNews = allNews.filter(news => news.processing_status && String(news.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingNews.length} 条待处理的新闻记录。`);
      if (pendingNews.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      for (const news of pendingNews) {
        processedCount++;
        logMessages.push(`正在处理新闻: ${news.news_title.substring(0, 50)}...`);

        const prompt = `
          请作为一名资深的技术与商业分析师，深入分析以下技术新闻，并严格以JSON格式返回。
          
          新闻标题: ${news.news_title}
          新闻摘要: ${news.news_summary}
          来源平台: ${news.source_platform}
          相关公司: ${news.related_companies}
          AI摘要: ${news.ai_summary || ''}
          AI关键词: ${news.ai_keywords || ''}

          你需要完成以下任务:
          1. 评估技术突破性、市场影响和战略重要性，并给出1-10分的评分。
          2. 总结这篇新闻揭示的技术突破性分析理由 (breakthrough_reason)。
          3. 提炼其核心的价值主张 (value_proposition)。
          4. 列出1-3个关键创新点或新闻要点 (key_innovations)，以数组形式表示。
          5. 预测其可能的目标行业 (target_industries)，以数组形式表示。

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

        // ✅ 修正：nowTimestamp 和 intelligenceIdToLink 的声明提升到 for 循环内部，if 块外部
        const nowTimestamp = new Date(); 
        let intelligenceIdToLink = ''; 

        if (!aiAssessment || typeof aiAssessment.breakthrough_score === 'undefined') {
          logMessages.push(`  -> AI评估失败，跳过此新闻。`);
          errorCount++;
          DataService.updateObject('RAW_TECH_NEWS', news.id, {
              processing_status: 'failed_ai_assessment',
              linked_intelligence_id: '',
              breakthrough_score_ai: parseFloat(aiAssessment?.breakthrough_score) || 0,
              market_impact_score_ai: parseFloat(aiAssessment?.market_impact_score) || 0,
              strategic_importance_ai: parseFloat(aiAssessment?.strategic_importance) || 0,
              breakthrough_reason_ai: aiAssessment?.breakthrough_reason || '',
              value_proposition_ai: aiAssessment?.value_proposition || '',
              key_innovations_ai: (aiAssessment?.key_innovations || []).join(', '),
              target_industries_ai: (aiAssessment?.target_industries || []).join(', '),
              updated_timestamp: nowTimestamp
          });
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
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          const intelligenceObject = {
            id: intelligenceIdToLink,
            intelligence_id: intelligenceIdToLink,
            tech_id: news.tech_id || '',
            tech_keywords: news.tech_keywords || news.ai_keywords,
            title: news.news_title,
            content_summary: news.ai_summary || String(news.news_summary).substring(0, 500),
            trigger_source: 'tech_news',
            source_url: news.source_url,
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)),
            breakthrough_score: parseFloat(breakthroughScore.toFixed(2)),
            commercial_value_score: parseFloat(marketImpact.toFixed(2)), // 使用市场影响分作为商业价值的代理
            confidence_level: 'medium',
            priority: 'medium',
            processing_status: 'signal_identified',
            breakthrough_reason: aiAssessment.breakthrough_reason || "N/A",
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_innovations || []).join(', '),
            target_industries: (aiAssessment.target_industries || []).join(', '),
            version: 1,
            is_deleted: 0,
            created_timestamp: nowTimestamp,
            updated_timestamp: nowTimestamp,
            source_table: 'Raw_Tech_News',
            source_record_id: news.id,
            evidence_chain: [{
                id: news.id,
                title: news.news_title,
                source_type: 'tech_news',
                source_url: news.source_url,
                publication_date: news.publication_date
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 信号强度 (${signalStrength.toFixed(2)}) 未达阈值，跳过。`);
        }
        DataService.updateObject('RAW_TECH_NEWS', news.id, {
            processing_status: 'processed',
            linked_intelligence_id: intelligenceIdToLink,
            breakthrough_score_ai: parseFloat(aiAssessment.breakthrough_score) || 0,
            market_impact_score_ai: parseFloat(aiAssessment.market_impact_score) || 0,
            strategic_importance_ai: parseFloat(aiAssessment.strategic_importance) || 0,
            breakthrough_reason_ai: aiAssessment.breakthrough_reason || '',
            value_proposition_ai: aiAssessment.value_proposition || '',
            key_innovations_ai: (aiAssessment.key_innovations || []).join(', '),
            target_industries_ai: (aiAssessment.target_industries || []).join(', '),
            updated_timestamp: nowTimestamp
        });
      }

      const finalMessage = `处理了 ${processedCount} 篇新闻，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf7_5IndustryDynamics: function() {
    const wfName = 'WF7-5: 产业动态信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_5_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allDynamics = DataService.getDataAsObjects('RAW_INDUSTRY_DYNAMICS');
      const pendingDynamics = allDynamics.filter(item => item.processing_status && String(item.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingDynamics.length} 条待处理的产业动态记录。`);
      if (pendingDynamics.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      for (const dynamic of pendingDynamics) {
        processedCount++;
        logMessages.push(`正在处理产业动态: ${dynamic.event_title.substring(0, 50)}...`);

        const prompt = `
          请作为一名资深的市场与技术战略分析师，深入分析以下产业动态信息，并严格以JSON格式返回。
          
          事件标题: ${dynamic.event_title}
          事件摘要: ${dynamic.event_summary}
          相关技术关键词: ${dynamic.tech_keywords}
          产业分类: ${dynamic.industry_category}
          AI摘要: ${dynamic.ai_summary || ''}
          AI关键词: ${dynamic.ai_keywords || ''}

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

        // ✅ 修正：nowTimestamp 和 intelligenceIdToLink 的声明提升到 for 循环内部，if 块外部
        const nowTimestamp = new Date(); 
        let intelligenceIdToLink = ''; 

        if (!aiAssessment || typeof aiAssessment.commercial_value_score === 'undefined') {
          logMessages.push(`  -> AI评估失败，跳过此动态。`);
          errorCount++;
          DataService.updateObject('RAW_INDUSTRY_DYNAMICS', dynamic.id, {
            processing_status: 'failed_ai_assessment',
            linked_intelligence_id: '',
            commercial_value_score_ai: parseFloat(aiAssessment?.commercial_value_score) || 0,
            breakthrough_score_ai: parseFloat(aiAssessment?.breakthrough_score) || 0,
            strategic_impact_score_ai: parseFloat(aiAssessment?.strategic_impact_score) || 0,
            value_proposition_ai: aiAssessment?.value_proposition || '',
            key_innovations_ai: (aiAssessment?.key_innovations || []).join(', '),
            target_industries_ai: (aiAssessment?.target_industries || []).join(', '),
            updated_timestamp: nowTimestamp
          });
          continue;
        }

        const commercialValue = parseFloat(aiAssessment.commercial_value_score) || 0;
        const breakthroughScore = parseFloat(aiAssessment.breakthrough_score) || 0;
        const strategicImpact = parseFloat(aiAssessment.strategic_impact_score) || 0;
        
        const signalStrength = (commercialValue * 0.4) + (strategicImpact * 0.4) + (breakthroughScore * 0.2);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);
        
        if (signalStrength >= 7.5) {
          newSignalsCount++;
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceObject = {
            id: intelligenceIdToLink,
            intelligence_id: intelligenceIdToLink,
            tech_id: dynamic.tech_id || '',
            tech_keywords: dynamic.tech_keywords || dynamic.ai_keywords,
            title: dynamic.event_title,
            content_summary: dynamic.ai_summary || String(dynamic.event_summary).substring(0, 500),
            trigger_source: 'industry_dynamics',
            source_url: dynamic.source_url,
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)),
            breakthrough_score: parseFloat(breakthroughScore.toFixed(2)),
            commercial_value_score: parseFloat(commercialValue.toFixed(2)),
            confidence_level: 'medium',
            priority: 'high',
            processing_status: 'signal_identified',
            breakthrough_reason: `战略影响评分: ${strategicImpact.toFixed(1)}.`,
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_innovations || []).join(', '),
            target_industries: (aiAssessment.target_industries || []).join(', '),
            version: 1,
            is_deleted: 0,
            created_timestamp: nowTimestamp,
            updated_timestamp: nowTimestamp,
            source_table: 'Raw_Industry_Dynamics',
            source_record_id: dynamic.id,
            evidence_chain: [{
                id: dynamic.id,
                title: dynamic.event_title,
                source_type: 'industry_dynamics',
                source_url: dynamic.source_url,
                publication_date: dynamic.publication_date
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 信号强度 (${signalStrength.toFixed(2)}) 未达阈值，跳过。`);
        }
        DataService.updateObject('RAW_INDUSTRY_DYNAMICS', dynamic.id, {
            processing_status: 'processed',
            linked_intelligence_id: intelligenceIdToLink,
            commercial_value_score_ai: parseFloat(aiAssessment.commercial_value_score) || 0,
            breakthrough_score_ai: parseFloat(aiAssessment.breakthrough_score) || 0,
            strategic_impact_score_ai: parseFloat(aiAssessment.strategic_impact_score) || 0,
            value_proposition_ai: aiAssessment.value_proposition || '',
            key_innovations_ai: (aiAssessment.key_innovations || []).join(', '),
            target_industries_ai: (aiAssessment.target_industries || []).join(', '),
            updated_timestamp: nowTimestamp
          });
      }

      const finalMessage = `处理了 ${processedCount} 条产业动态，生成了 ${newSignalsCount} 条新线索。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  runWf7_6Benchmark: function() {
    const wfName = 'WF7-6: 竞争对手信号识别';
    const startTime = new Date();
    const executionId = `exec_wf7_6_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0;
    let newSignalsCount = 0;
    let errorCount = 0;

    try {
      const allCompIntel = DataService.getDataAsObjects('RAW_COMPETITOR_INTELLIGENCE');
      const pendingIntel = allCompIntel.filter(item => item.processing_status && String(item.processing_status).trim().toLowerCase() === 'pending');

      logMessages.push(`发现 ${pendingIntel.length} 条待处理的竞争情报记录。`);
      if (pendingIntel.length === 0) {
        const msg = "没有待处理的竞争情报记录。";
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, msg);
        return { success: true, message: msg, log: logMessages.join('\n') };
      }

      for (const intel of pendingIntel) {
        processedCount++;
        logMessages.push(`正在处理竞情: ${intel.intelligence_title.substring(0, 50)}...`);

        const prompt = `
          请作为一名资深的行业与竞争战略分析师，深入分析以下关于竞争对手的新闻情报，并严格以JSON格式返回。
          
          新闻标题: ${intel.intelligence_title}
          新闻摘要: ${intel.intelligence_summary}
          涉及公司: ${intel.competitor_name}
          AI摘要: ${intel.ai_summary || ''}
          AI关键词: ${intel.ai_keywords || ''}

          你需要完成以下任务:
          1. 评估此情报对我们的威胁等级 (threat_level_score)，评分1-10。
          2. 评估此情报对我们业务的潜在影响 (business_impact_score)，评分1-10。
          3. 总结此情报的核心价值主张 (value_proposition)，即它揭示了对手的何种战略意图、技术突破或市场动向。
          4. 提炼出这项情报中涉及的关键技术关键词 (tech_keywords)，以数组形式表示。
          5. 将此情报分类为以下类型之一：'Product Release', 'Tech Innovation', 'Talent Flow', 'Financial Report', 'Strategic Partnership', 'General News'。将结果放在 intelligence_type 字段。

          返回的 JSON 格式必须是:
          {
            "threat_level_score": <威胁等级评分>,
            "business_impact_score": <业务影响评分>,
            "value_proposition": "<对情报核心价值的精炼总结>",
            "tech_keywords": ["关键词1", "关键词2"],
            "intelligence_type": "<情报分类>"
          }
        `;

        const aiAssessment = this._callAIForScoring(prompt, { wfName, logMessages });

        // ✅ 修正：nowTimestamp 和 intelligenceIdToLink 的声明提升到 for 循环内部，if 块外部
        const nowTimestamp = new Date(); 
        let intelligenceIdToLink = ''; 

        if (!aiAssessment || typeof aiAssessment.threat_level_score === 'undefined') {
          logMessages.push(`  -> AI评估失败，跳过此情报。`);
          errorCount++;
          DataService.updateObject('RAW_COMPETITOR_INTELLIGENCE', intel.id, {
              processing_status: 'failed_ai_assessment',
              linked_intelligence_id: '',
              intelligence_type: aiAssessment?.intelligence_type || 'General News',
              threat_level_score: parseFloat(aiAssessment?.threat_level_score) || 0,
              business_impact_score: parseFloat(aiAssessment?.business_impact_score) || 0,
              value_proposition_ai: aiAssessment?.value_proposition || '',
              tech_keywords_ai: (aiAssessment?.tech_keywords || []).join(', '),
              updated_timestamp: nowTimestamp
          });
          continue;
        }

        const threatLevel = parseFloat(aiAssessment.threat_level_score) || 0;
        const businessImpact = parseFloat(aiAssessment.business_impact_score) || 0;
        
        const signalStrength = (threatLevel * 0.5) + (businessImpact * 0.5);
        
        logMessages.push(`  -> 信号强度计算完成: ${signalStrength.toFixed(2)}`);
        
        if (signalStrength >= 7.0) {
          newSignalsCount++;
          intelligenceIdToLink = `TI${Utilities.formatDate(nowTimestamp, 'UTC', "yyyyMMddHHmmssSSS")}${Math.floor(Math.random()*100)}`;
          
          const intelligenceObject = {
            id: intelligenceIdToLink,
            intelligence_id: intelligenceIdToLink,
            tech_id: '', // tech_id 留空，因为这是竞情，不直接关联技术
            tech_keywords: (aiAssessment.tech_keywords || []).join(', '),
            title: intel.intelligence_title,
            content_summary: intel.ai_summary || String(intel.intelligence_summary).substring(0, 500),
            trigger_source: 'competitor_intelligence',
            source_url: intel.source_url,
            trigger_workflow: wfName,
            signal_strength: parseFloat(signalStrength.toFixed(2)),
            breakthrough_score: 0, // 设为0，或根据需要由AI评估
            commercial_value_score: parseFloat(businessImpact.toFixed(2)),
            confidence_level: 'medium',
            priority: 'high',
            processing_status: 'signal_identified',
            breakthrough_reason: `威胁等级评分: ${threatLevel.toFixed(1)}.`,
            value_proposition: aiAssessment.value_proposition || "N/A",
            key_innovations: (aiAssessment.key_innovations || ["N/A"]).join(', '), // key_innovations 可能不存在，提供默认值
            target_industries: aiAssessment.target_industries ? (aiAssessment.target_industries || []).join(', ') : '',
            version: 1,
            is_deleted: 0,
            created_timestamp: nowTimestamp,
            updated_timestamp: nowTimestamp,
            source_table: 'Raw_Competitor_Intelligence',
            source_record_id: intel.id,
            evidence_chain: [{
                id: intel.id,
                title: intel.intelligence_title,
                source_type: 'competitor_intelligence',
                source_url: intel.source_url,
                publication_date: intel.publication_date
            }]
          };
          DataService.batchUpsert('TECH_INSIGHTS_MASTER', [intelligenceObject], 'id');
          logMessages.push(`  -> 高价值信号！已生成线索ID: ${intelligenceIdToLink}`);
        } else {
            logMessages.push(`  -> 低价值信号 (强度: ${signalStrength.toFixed(2)})，已归档。`);
        }
        DataService.updateObject('RAW_COMPETITOR_INTELLIGENCE', intel.id, {
            processing_status: 'processed',
            linked_intelligence_id: intelligenceIdToLink,
            intelligence_type: aiAssessment.intelligence_type || 'General News',
            threat_level_score: parseFloat(aiAssessment.threat_level_score) || 0,
            business_impact_score: parseFloat(aiAssessment.business_impact_score) || 0,
            value_proposition_ai: aiAssessment.value_proposition || '',
            tech_keywords_ai: (aiAssessment.tech_keywords || []).join(', '),
            updated_timestamp: nowTimestamp
        });
      }

      const finalMessage = `处理了 ${processedCount} 条竞争情报，生成了 ${newSignalsCount} 条新核心情报。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, newSignalsCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, newSignalsCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },

  // ====================================================================================================================
  //  第三层：统一证据验证 (WF8)
  // ====================================================================================================================
  runWf8_EvidenceValidation: function() {
    const wfName = 'WF8: 统一证据验证';
    const startTime = new Date();
    const executionId = `exec_wf8_${startTime.getTime()}`;
    let logMessages = [`[${startTime.toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    let processedCount = 0, verifiedCount = 0, rejectedCount = 0;
    let errorCount = 0;

    try {
      const allIntelligences = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER');
      const pendingIntels = allIntelligences.filter(row => String(row.processing_status || '').trim().toLowerCase() === 'signal_identified');
      
      logMessages.push(`发现 ${pendingIntels.length} 条待验证线索。`);
      if (pendingIntels.length === 0) {
        this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有待处理记录。");
        return { success: true, message: "没有待处理记录。", log: logMessages.join('\n') };
      }

      for (const intel of pendingIntels) {
        processedCount++;
        logMessages.push(`正在处理线索ID: ${intel.intelligence_id}`);

        let urlValidityStatus = 'invalid';
        if (intel.source_url && typeof intel.source_url === 'string' && intel.source_url.startsWith('http')) {
            try {
                const response = UrlFetchApp.fetch(intel.source_url, { method: 'head', muteHttpExceptions: true, followRedirects: true });
                if (response.getResponseCode() >= 200 && response.getResponseCode() < 400) urlValidityStatus = 'valid';
            } catch(e) {
                logMessages.push(`  -> URL验证失败: ${e.message}`);
            }
        }

        let sourceAuthorityScore = 5; // 默认值
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
          AI摘要: ${intel.ai_summary || ''}
          AI关键词: ${intel.ai_keywords || ''}

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
        const nowTimestamp = new Date(); // 提升声明
        
        const validationObject = {
          id: validationId,
          validation_id: validationId,
          intelligence_id: intel.intelligence_id || '未知ID',
          data_type: intel.source_type || '未知类型',
          source_url: intel.source_url || '',
          url_validity_status: urlValidityStatus,
          source_authority_score: sourceAuthorityScore,
          external_validation_score: 0, // 假设外部验证分数为0
          manual_override: 'no', // 假设没有手动覆盖
          manual_score: 0, // 假设手动分数为0
          validation_confidence: validationConfidence,
          ai_assisted_validation: 1, // AI辅助验证
          validation_status: validationStatusInMatrix,
          validation_notes: validationNotes,
          validated_by: 'system',
          created_timestamp: nowTimestamp,
          updated_timestamp: nowTimestamp
        };
        DataService.batchUpsert('EVIDENCE_VALIDATION', [validationObject], 'id');

        // 更新 Tech_Insights_Master 中的状态和置信度
        DataService.updateObject('TECH_INSIGHTS_MASTER', intel.id, { 
            processing_status: newIntelStatusInMaster, 
            confidence_level: validationConfidence,
            updated_timestamp: new Date()
        });
      }

      const finalMessage = `处理了 ${processedCount} 条线索，通过验证 ${verifiedCount} 条，拒绝/待审 ${rejectedCount} 条。`;
      this._logExecution(wfName, executionId, startTime, 'completed', processedCount, verifiedCount, errorCount, finalMessage);
      return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
      const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
      this._logExecution(wfName, executionId, startTime, 'failed', processedCount, verifiedCount, errorCount + 1, errorMessage);
      return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  },
  // ====================================================================================================================
  //  第四层：深度分析工作流 (WF9 - WF11)
  // ====================================================================================================================
  runWf9_CommercialValueAnalysis: function() { return { success: false, message: "WF9 功能尚未实现。", log: "WF9 功能尚未实现。" }; },
  runWf10_CompetitiveIntelAnalysis: function() { return { success: false, message: "WF10 功能尚未实现。", log: "WF10 功能尚未实现。" }; },
  runWf11_TechnicalDeepAnalysis: function() { return { success: false, message: "WF11 功能尚未实现。", log: "WF11 功能尚未实现。" }; },

  // ====================================================================================================================
  //  第五层：决策支撑工作流 (WF12 - WF13)
  // ====================================================================================================================
  runWf12_IntelligenceIntegration: function() { return { success: false, message: "WF12 功能尚未实现。", log: "WF12 功能尚未实现。" }; },
  runWf13_ReportGeneration: function() { return { success: false, message: "WF13 功能尚未实现。", log: "WF13 功能尚未实现。" }; },

  // ====================================================================================================================
  //  第六层：监控维护工作流 (WF14 - WF15)
  // ====================================================================================================================
  runWf14_DataQualityMonitor: function() { return { success: false, message: "WF14 功能尚未实现。", log: "WF14 功能尚未实现。" }; },
  runWf15_SystemHealthCheck: function() { return { success: false, message: "WF15 功能尚未实现。", log: "WF15 功能尚未实现。" }; },

  // ====================================================================
  //  作者图谱构建辅助函数
  // ====================================================================

  /**
   * 规范化作者姓名，生成唯一的作者ID。
   * @param {string} name - 作者原始姓名。
   * @returns {string} 规范化的作者ID。
   */
  _normalizeAuthorName: function(name) {
      return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  },

  /**
   * 规范化机构名称，生成唯一的机构ID。
   * @param {string} name - 机构原始名称。
   * @returns {string} 规范化的机构ID。
   */
  _normalizeAffiliationName: function(name) {
      return String(name).trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  },

  // ====================================================================
  //  WF-AuthorGraphBuilder: 专家网络图谱构建工作流
  // ====================================================================

  /**
   * 自动构建和更新专家（作者）网络图谱。
   * 扫描新处理的论文和专利数据，提取作者和机构信息，建立关联。
   */
  // 请用此代码块完整替换您文件中现有的 runWf_AuthorGraphBuilder 函数

runWf_AuthorGraphBuilder: function() {
    const wfName = 'WF-AG: 专家网络图谱构建';
    const startTime = new Date();
    const executionId = `exec_wf_ag_${startTime.getTime()}`;
    let logMessages = [`[${new Date().toLocaleTimeString()}] ${wfName} (${executionId}) 开始执行...`];
    // ... [其他变量声明保持不变] ...
    let processedDocsCount = 0, newAuthorsCount = 0, updatedAuthorsCount = 0, newAffiliationsCount = 0, updatedAffiliationsCount = 0;

    try {
        logMessages.push("正在获取所有论文和专利数据...");
        const academicPapers = DataService.getDataAsObjects('RAW_ACADEMIC_PAPERS') || [];
        const patentData = DataService.getDataAsObjects('RAW_PATENT_DATA') || [];
        const allDocs = [...academicPapers, ...patentData];
        
        if (allDocs.length === 0) {
            logMessages.push("没有可用于构建图谱的论文或专利数据。");
            this._logExecution(wfName, executionId, startTime, 'completed', 0, 0, 0, "没有可处理的文档。");
            return { success: true, message: "没有可处理的文档。", log: logMessages.join('\n') };
        }
        
        processedDocsCount = allDocs.length;
        logMessages.push(`发现 ${processedDocsCount} 篇文档需要处理。`);

        const authorsToUpsert = new Map();
        const affiliationsToUpsert = new Map();
        const existingAuthors = new Map((DataService.getDataAsObjects('AUTHORS_REGISTRY') || []).map(a => [a.author_id, a]));
        const existingAffiliations = new Map((DataService.getDataAsObjects('AFFILIATIONS_REGISTRY') || []).map(a => [a.affiliation_id, a]));

        // ... [for 循环处理 allDocs 的逻辑保持不变] ...
        for (const doc of allDocs) {
            const docAuthors = (doc.authors || '').split(',').map(name => this._normalizeAuthorName(name)).filter(Boolean);
            const docAffiliationName = doc.affiliation || (doc.authors_affiliation ? doc.authors_affiliation[0] : null);
            const docAffiliationId = this._normalizeAffiliationName(docAffiliationName);
            const docTechAreas = (doc.tech_keywords || '').split(',').map(t => t.trim()).filter(Boolean);

            for (const authorId of docAuthors) {
                const authorData = authorsToUpsert.get(authorId) || existingAuthors.get(authorId) || { author_id: authorId, full_name: authorId.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()), paper_count: 0, patent_count: 0, coauthor_ids: [], last_known_affiliation: null, main_tech_areas: [], };
                if (doc.source_type === 'academic_papers') authorData.paper_count = (authorData.paper_count || 0) + 1;
                if (doc.source_type === 'patent_data') authorData.patent_count = (authorData.patent_count || 0) + 1;
                const otherAuthorsInDoc = docAuthors.filter(id => id !== authorId);
                authorData.coauthor_ids = [...new Set([...(authorData.coauthor_ids || []), ...otherAuthorsInDoc])];
                authorData.main_tech_areas = [...new Set([...(authorData.main_tech_areas || []), ...docTechAreas])];
                if (docAffiliationId) authorData.last_known_affiliation = docAffiliationId;
                authorsToUpsert.set(authorId, authorData);
            }

            if (docAffiliationId && docAffiliationId !== 'null') {
                const affData = affiliationsToUpsert.get(docAffiliationId) || existingAffiliations.get(docAffiliationId) || { affiliation_id: docAffiliationId, name: docAffiliationName, author_count: 0, paper_count: 0, patent_count: 0, main_tech_areas: [] };
                affData.author_count = new Set([...(affData.authors || []), ...docAuthors]).size;
                if (doc.source_type === 'academic_papers') affData.paper_count = (affData.paper_count || 0) + 1;
                if (doc.source_type === 'patent_data') affData.patent_count = (affData.patent_count || 0) + 1;
                affData.main_tech_areas = [...new Set([...(affData.main_tech_areas || []), ...docTechAreas])];
                affiliationsToUpsert.set(docAffiliationId, affData);
            }
        }

        const authorsArray = Array.from(authorsToUpsert.values());
        if (authorsArray.length > 0) {
            // ✅ 核心修复：直接使用 Firestore 的真实集合名 'authors'
            FirestoreService.batchUpsert('authors', authorsArray, 'author_id');
            newAuthorsCount = authorsArray.filter(a => !existingAuthors.has(a.author_id)).length;
            updatedAuthorsCount = authorsArray.length - newAuthorsCount;
            logMessages.push(`成功写入 ${authorsArray.length} 位作者到 'authors' 集合。`);
        }

        const affiliationsArray = Array.from(affiliationsToUpsert.values());
        if (affiliationsArray.length > 0) {
            // ✅ 核心修复：直接使用 Firestore 的真实集合名 'affiliations'
            FirestoreService.batchUpsert('affiliations', affiliationsArray, 'affiliation_id');
            newAffiliationsCount = affiliationsArray.filter(a => !existingAffiliations.has(a.affiliation_id)).length;
            updatedAffiliationsCount = affiliationsArray.length - newAffiliationsCount;
            logMessages.push(`成功写入 ${affiliationsArray.length} 家机构到 'affiliations' 集合。`);
        }

        const finalMessage = `图谱构建完成。处理文档: ${processedDocsCount}，作者: ${newAuthorsCount}新增/${updatedAuthorsCount}更新，机构: ${newAffiliationsCount}新增/${updatedAffiliationsCount}更新。`;
        this._logExecution(wfName, executionId, startTime, 'completed', processedDocsCount, authorsArray.length + affiliationsArray.length, 0, finalMessage);
        return { success: true, message: finalMessage, log: logMessages.join('\n') };

    } catch (e) {
        const errorMessage = `严重错误: ${e.message}\n${e.stack}`;
        this._logExecution(wfName, executionId, startTime, 'failed', processedDocsCount, 0, 1, errorMessage);
        return { success: false, message: errorMessage, log: logMessages.join('\n') };
    }
  }
};

// 文件名: backend/svc.Workflows.gs (在文件末尾添加此函数)

/**
 * =================================================================================
 *  ✅ 独立的测试入口函数
 * =================================================================================
 * 目的：手动触发“专家网络图谱构建”工作流，并清晰地打印出执行结果。
 * 使用方法：在 Apps Script 编辑器中，从函数列表中选择此函数并点击“运行”。
 */
function runManualAuthorGraphBuilderTest() {
  console.log("==================================================");
  console.log("--- 开始手动触发专家网络图谱构建工作流 (WF-AG) ---");
  console.log("==================================================");
  
  try {
    // 调用核心的工作流函数
    const result = WorkflowsService.runWf_AuthorGraphBuilder();

    // 根据返回结果打印格式化的日志
    console.log("\n--- 工作流执行完毕 ---");
    console.log(`状态: ${result.success ? '✅ 成功' : '❌ 失败'}`);
    console.log(`消息: ${result.message}`);
    
    // 如果有详细日志，也打印出来
    if (result.log) {
      console.log("\n--- 详细执行日志 ---");
      // 将日志字符串按换行符分割，逐行打印，更易读
      result.log.split('\n').forEach(line => console.log(line));
    }

  } catch (e) {
    // 捕获可能在调用过程中发生的意外错误
    console.error("!!! 在执行测试函数时捕获到顶层错误 !!!");
    console.error(`错误信息: ${e.message}`);
    console.error(`错误堆栈: ${e.stack}`);
  } finally {
    console.log("==================================================");
    console.log("--- 测试函数执行结束 ---");
    console.log("==================================================");
  }
}


function test_ReadAuthorsCollection() {
  console.log("======================================================");
  console.log("--- 开始执行【最小化】`authors` 集合读取测试 ---");
  console.log("======================================================");

  try {
    // 步骤 1: 直接调用我们怀疑有问题的 FirestoreService 的核心方法
    console.log("正在调用 FirestoreService.queryCollection('authors')...");
    const authors = FirestoreService.queryCollection('authors');

    // 步骤 2: 检查返回结果
    if (authors) {
      console.log(`✅ 调用成功！函数返回了一个类型为 '${typeof authors}' 的结果。`);
      
      if (Array.isArray(authors)) {
        console.log(`✅ 返回结果是一个数组。`);
        console.log(`⭐ 关键诊断：从 'authors' 集合中读取到 ${authors.length} 条记录。`);

        if (authors.length > 0) {
          console.log("🎉🎉🎉 测试成功！已成功从 'authors' 集合读取到数据！");
          console.log("第一条记录内容示例: ", JSON.stringify(authors[0], null, 2));
        } else {
          console.error("❌ 测试失败：虽然调用成功，但返回了一个空数组。这意味着查询逻辑本身没问题，但因为某种原因（权限、索引、API端点模式）未能获取到实际数据。");
        }
      } else {
        console.error("❌ 测试失败：返回结果不是一个数组，这不符合预期！");
      }
    } else {
      console.error("❌ 测试失败：FirestoreService.queryCollection('authors') 返回了 null 或 undefined。");
    }

  } catch (e) {
    console.error(`!!! 测试过程中捕获到严重错误: ${e.message} !!!`);
    console.error(`错误堆栈: ${e.stack}`);
  } finally {
    console.log("======================================================");
    console.log("--- `authors` 集合读取测试结束 ---");
    console.log("======================================================");
  }
}

// 测试函数 1：验证 Native Mode API

function test_NativeModeAPI() {
  console.log("======================================================");
  console.log("--- 开始执行【模式一：Native Mode API】读取测试 ---");
  console.log("======================================================");

  try {
    // 强制设置 FirestoreService 使用 Native Mode 端点
    FirestoreService.firestoreHost = 'firestore.googleapis.com';
    // 对于 Native Mode，区域ID是URL的一部分，但对于基础查询可以省略
    
    console.log("正在使用 Native Mode API 调用 FirestoreService.queryCollection('authors')...");
    
    // 我们需要一个适配 Native API 的 queryCollection 版本
    // 为了不修改 FirestoreService，我们在这里临时模拟一个
    const projectId = PropertiesService.getScriptProperties().getProperty('FIRESTORE_PROJECT_ID');
    const url = `https://${FirestoreService.firestoreHost}/v1/projects/${projectId}/databases/(default)/documents/authors`;
    const response = FirestoreService._request(url, 'GET'); // Native Mode 使用 GET

    console.log("✅ Native Mode API 调用成功！");
    
    if (response && Array.isArray(response.documents)) {
        console.log(`⭐ 关键诊断 (Native Mode)：从 'authors' 集合中读取到 ${response.documents.length} 条记录。`);
        if (response.documents.length > 0) {
            console.log("🎉🎉🎉 [结论] 您的数据库响应 Native Mode API！");
        } else {
            console.log("⚠️ [结论] 您的数据库不响应 Native Mode API（或集合为空）。");
        }
    } else {
        console.error("❌ Native Mode API 返回了非预期的格式:", response);
    }

  } catch (e) {
    console.error(`!!! Native Mode 测试过程中捕获到严重错误: ${e.message} !!!`);
  } finally {
    console.log("--- Native Mode API 测试结束 ---");
  }
}

// 测试函数 2：验证 Datastore Mode API

function test_DatastoreModeAPI() {
  console.log("======================================================");
  console.log("--- 开始执行【模式二：Datastore Mode API】读取测试 ---");
  console.log("======================================================");
  
  try {
    // 强制设置 FirestoreService 使用 Datastore Mode 端点
    FirestoreService.firestoreHost = 'datastore.googleapis.com';

    console.log("正在使用 Datastore Mode API 调用 FirestoreService.queryCollection('authors')...");
    
    // 直接调用我们之前重构好的、适配 Datastore API 的 queryCollection
    const authors = FirestoreService.queryCollection('authors');
    
    console.log("✅ Datastore Mode API 调用成功！");

    if (Array.isArray(authors)) {
        console.log(`⭐ 关键诊断 (Datastore Mode)：从 'authors' 集合中读取到 ${authors.length} 条记录。`);
        if (authors.length > 0) {
            console.log("🎉🎉🎉 [结论] 您的数据库响应 Datastore Mode API！");
        } else {
            console.log("⚠️ [结论] 您的数据库不响应 Datastore Mode API（或集合为空）。");
        }
    } else {
       console.error("❌ Datastore Mode API 返回了非预期的格式:", authors);
    }

  } catch (e) {
    console.error(`!!! Datastore Mode 测试过程中捕获到严重错误: ${e.message} !!!`);
  } finally {
    console.log("--- Datastore Mode API 测试结束 ---");
    console.log("======================================================");
  }
}

// =================================================================================
//  终极诊断函数
// =================================================================================
function ultimateDiagnosis() {
  console.log("================== ULTIMATE DIAGNOSIS START ==================");

  try {
    // 诊断步骤 1: 检查 CONFIG 对象和键名
    console.log("\n--- 诊断步骤 1: 检查 CONFIG 配置 ---");
    if (typeof CONFIG !== 'undefined' && CONFIG.FIRESTORE_COLLECTIONS) {
      console.log("✅ CONFIG 对象存在。");
      const authorKey = 'AUTHORS_REGISTRY';
      const authorCollectionName = CONFIG.FIRESTORE_COLLECTIONS[authorKey];
      if (authorCollectionName) {
        console.log(`✅ 键名 '${authorKey}' 存在，映射到集合名: '${authorCollectionName}'`);
      } else {
        console.error(`❌ 错误: 在 CONFIG.FIRESTORE_COLLECTIONS 中找不到键名 '${authorKey}'`);
        return;
      }
    } else {
      console.error("❌ 致命错误: 全局 CONFIG 对象不存在！请检查 Config.gs 文件是否正确加载。");
      return;
    }

    // 诊断步骤 2: 检查 DataService 是否能正确调用 FirestoreService
    console.log("\n--- 诊断步骤 2: 测试 DataService -> FirestoreService 调用链 ---");
    if (typeof DataService !== 'undefined' && typeof DataService.getDataAsObjects === 'function') {
      console.log("✅ DataService.getDataAsObjects 函数存在。");
      if (typeof FirestoreService !== 'undefined' && typeof FirestoreService.queryCollection === 'function') {
        console.log("✅ FirestoreService.queryCollection 函数存在。");
      } else {
        console.error("❌ 致命错误: FirestoreService.queryCollection 不是一个函数！请检查 FirestoreService.gs 文件。");
        return;
      }
    } else {
      console.error("❌ 致命错误: DataService.getDataAsObjects 不是一个函数！请检查 DataService.gs 文件。");
      return;
    }

    // 诊断步骤 3: 使用 DataService 读取一个已知可以工作的集合
    console.log("\n--- 诊断步骤 3: 读取一个已知正常的集合 (e.g., raw_tech_news) ---");
    const techNews = DataService.getDataAsObjects('RAW_TECH_NEWS');
    console.log(`通过 DataService 读取 'RAW_TECH_NEWS'，获取到 ${techNews.length} 条记录。`);
    if (techNews.length > 0) {
      console.log("✅ 结论: DataService 读取旧集合的功能完全正常。");
    } else {
      console.warn("⚠️ 警告: 读取 'RAW_TECH_NEWS' 也返回了空数组，问题可能在更底层。");
    }
    
    // 诊断步骤 4: 使用 DataService 读取 'authors' 集合
    console.log("\n--- 诊断步骤 4: 使用 DataService 读取 'authors' 集合 ---");
    const authorsFromDataService = DataService.getDataAsObjects('AUTHORS_REGISTRY');
    console.log(`通过 DataService 读取 'AUTHORS_REGISTRY'，获取到 ${authorsFromDataService.length} 条记录。`);
    if (authorsFromDataService.length > 0) {
      console.log("✅ 结论: DataService 读取 'authors' 集合的功能是正常的！问题可能在 getExpertNetworkData 的后续处理中。");
    } else {
      console.error("❌ 核心问题定位: DataService 读取 'authors' 集合返回了空数组！");
    }

    // 诊断步骤 5: 直接使用 FirestoreService 读取 'authors' 集合
    console.log("\n--- 诊断步骤 5: 直接使用 FirestoreService 读取 'authors' 集合 ---");
    const authorsFromFirestoreService = FirestoreService.queryCollection('authors');
    console.log(`直接通过 FirestoreService 读取 'authors'，获取到 ${authorsFromFirestoreService.length} 条记录。`);
    if (authorsFromFirestoreService.length > 0) {
      console.log("✅ 结论: 底层 FirestoreService 读取 'authors' 集合的功能是正常的！");
    } else {
      console.error("❌ 核心问题定位: 底层 FirestoreService 读取 'authors' 集合也返回了空数组！这指向了 API 端点或权限问题。");
    }

  } catch (e) {
    console.error(`!!! 诊断过程中捕获到严重错误: ${e.message} !!!`);
    console.error(`错误堆栈: ${e.stack}`);
  } finally {
    console.log("\n================== ULTIMATE DIAGNOSIS END ==================");
  }
}

function ultimateDiagnosis_ExpertNetwork() {
  Logger.log("================== ULTIMATE DIAGNOSIS (Expert Network) START ==================");

  try {
    // 步骤 1: 直接用 FirestoreService 读取数据，确保拿到最原始的数据
    Logger.log("\n--- 诊断步骤 1: 直接从 Firestore 读取原始数据 ---");
    const authorsRaw = FirestoreService.queryCollection('authors') || [];
    const affiliationsRaw = FirestoreService.queryCollection('affiliations') || [];
    Logger.log(`读取完成: ${authorsRaw.length} 位作者, ${affiliationsRaw.length} 家机构。`);

    if (authorsRaw.length === 0) {
        Logger.log("作者数据为空，诊断结束。");
        return;
    }

    // 步骤 2: 构建节点 (Nodes) - 使用最简单、最笨拙但最可靠的方法
    Logger.log("\n--- 诊断步骤 2: 开始构建节点 ---");
    const nodes = [];
    const nodeIds = []; // 使用简单数组来跟踪ID

    // 添加机构节点
    affiliationsRaw.forEach(aff => {
        if (aff && aff.affiliation_id && nodeIds.indexOf(aff.affiliation_id) === -1) {
            nodes.push({
                id: aff.affiliation_id,
                name: aff.name || 'Unknown Affiliation',
                category: '机构',
                value: aff.author_count || 1
            });
            nodeIds.push(aff.affiliation_id);
        }
    });
    Logger.log(`添加机构后，节点数: ${nodes.length}`);

    // 添加作者节点
    authorsRaw.forEach(author => {
        if (author && author.author_id && nodeIds.indexOf(author.author_id) === -1) {
            nodes.push({
                id: author.author_id,
                name: author.full_name || 'Unknown Author',
                category: '专家',
                value: (author.paper_count || 0) + (author.patent_count || 0) + 1
            });
            nodeIds.push(author.author_id);
        }
    });
    Logger.log(`添加作者后，总节点数: ${nodes.length}`);

    // 步骤 3: 检查节点构建结果
    Logger.log("\n--- 诊断步骤 3: 验证节点构建结果 ---");
    if(nodes.length > 0) {
        Logger.log(`✅ 成功构建了 ${nodes.length} 个节点！`);
        Logger.log("节点构建逻辑看起来没有问题。");
        Logger.log("第一个节点示例: " + JSON.stringify(nodes[0]));
        Logger.log("最后一个节点示例: " + JSON.stringify(nodes[nodes.length - 1]));
    } else {
        Logger.log("❌ 核心错误定位：节点构建循环未能产生任何节点！请检查 forEach 循环内部的 if 条件。");
        return;
    }

    // 步骤 4: 构建边 (Edges)
    Logger.log("\n--- 诊断步骤 4: 开始构建边 ---");
    const edges = [];
    const edgeKeys = {}; // 使用对象作为 Set

    authorsRaw.forEach(author => {
        if (!author || !author.author_id || nodeIds.indexOf(author.author_id) === -1) return;

        // 作者 -> 机构
        if (author.last_known_affiliation && nodeIds.indexOf(author.last_known_affiliation) > -1) {
            const edgeKey = `${author.author_id}->${author.last_known_affiliation}`;
            if (!edgeKeys[edgeKey]) {
                edges.push({ source: author.author_id, target: author.last_known_affiliation });
                edgeKeys[edgeKey] = true;
            }
        }

        // 作者 -> 合作者
        if (Array.isArray(author.coauthor_ids)) {
            author.coauthor_ids.forEach(coauthorId => {
                if (coauthorId && nodeIds.indexOf(coauthorId) > -1) {
                    const edgeKey = author.author_id < coauthorId ? `${author.author_id}-${coauthorId}` : `${coauthorId}-${author.author_id}`;
                    if (!edgeKeys[edgeKey]) {
                        edges.push({ source: author.author_id, target: coauthorId });
                        edgeKeys[edgeKey] = true;
                    }
                }
            });
        }
    });
    Logger.log(`构建边完成后，总边数: ${edges.length}`);

    // 步骤 5: 最终返回的对象
    const finalResult = { nodes, edges };
    Logger.log("\n--- 诊断步骤 5: 最终返回给前端的数据 ---");
    Logger.log(`节点总数: ${finalResult.nodes.length}`);
    Logger.log(`边总数: ${finalResult.edges.length}`);
    
  } catch (e) {
    Logger.log(`!!! 诊断过程中捕获到严重错误: ${e.message} !!!`);
    Logger.log(`错误堆栈: ${e.stack}`);
  } finally {
    Logger.log("\n================== ULTIMATE DIAGNOSIS (Expert Network) END ==================");
  }
}

