/**
 * @file layer01.DataConnector.js
 * @description [核心基础设施层] 通用API数据连接器。
 * [v18.1] 最终修正版：将fetchExternalData重构为标准的async函数，以根除潜在的执行时序问题。
 */
const DataConnector = {

  //==========================================================================
  // 内部缓存 (Internal Cache)
  //==========================================================================
  _sourceCache: {},

  /**
   * 清除所有缓存的数据源配置。
   */
  clearCache: function() {
    this._sourceCache = {};
    Logger.log("[DataConnector] 源配置缓存已清除。");
  },

  //==========================================================================
  // 数据源配置管理 (Source Configuration Management)
  //==========================================================================

  /**
   * 根据类型和可选的ID，获取单个数据源的完整配置。
   */
  getSourceConfig: function(sourceType, sourceId = null) {
    const cacheKey = sourceId ? `${sourceType}_${sourceId}` : `${sourceType}_single_priority`;
    if (this._sourceCache[cacheKey]) {
      return this._sourceCache[cacheKey];
    }
    
    const allSources = DataService.getDataAsObjects('REG_SOURCES');
    if (!allSources || allSources.length === 0) {
      throw new Error(`未在 Firestore 中找到任何外部数据源配置(REG_SOURCES)。`);
    }

    let targetSource = null;
    if (sourceId) {
      targetSource = allSources.find(s => s.is_active && s.source_id === sourceId);
    } else {
      const activeSources = allSources.filter(s => s.is_active && s.source_type.includes(sourceType));
      if (activeSources.length === 0) throw new Error(`未找到类型为 '${sourceType}' 的活跃外部数据源。`);
      activeSources.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      targetSource = activeSources[0];
    }

    if (!targetSource) {
      throw new Error(`未找到指定ID '${sourceId}' 或类型 '${sourceType}' 的活跃外部数据源。`);
    }

    if (targetSource.api_key_name) {
      const apiKey = PropertiesService.getScriptProperties().getProperty(targetSource.api_key_name);
      if (!apiKey) throw new Error(`数据源 '${targetSource.display_name}' 的 API Key 未配置 (键名: ${targetSource.api_key_name})。`);
      targetSource.apiKey = apiKey;
    }

    this._sourceCache[cacheKey] = targetSource;
    return targetSource;
  },

  /**
   * 获取指定类型的所有活跃数据源配置。
   */
  getAllActiveSourcesOfType: function(sourceType) {
    const cacheKey = `${sourceType}_all_active`;
    if (this._sourceCache[cacheKey]) { return this._sourceCache[cacheKey]; }

    const allSources = DataService.getDataAsObjects('REG_SOURCES');
    if (!allSources || allSources.length === 0) { return []; }

    const activeSources = allSources.filter(s => s.is_active && s.source_type.includes(sourceType));
    if (activeSources.length === 0) { return []; }

    const sourcesWithKeys = activeSources.map(source => {
      const enrichedSource = { ...source };
      if (enrichedSource.api_key_name) {
        const apiKey = PropertiesService.getScriptProperties().getProperty(enrichedSource.api_key_name);
        if (!apiKey) {
          Logger.log(`[DataConnector] 警告: 数据源 '${enrichedSource.display_name}' 的 Key 未配置，将跳过。`);
          return null;
        }
        enrichedSource.apiKey = apiKey;
      }
      return enrichedSource;
    }).filter(s => s !== null);

    sourcesWithKeys.sort((a, b) => (b.priority || 0) - (a.priority || 0));
    this._sourceCache[cacheKey] = sourcesWithKeys;
    return sourcesWithKeys;
  },

  /**
   * [v4.0 - 配置化时间范围] 获取外部数据。
   * 此版本完全由配置驱动，并能根据配置自动添加时间范围参数。
   */
  fetchExternalData: function(sourceConfig, endpointKey, dynamicParams = {}, extraOptions = {}) {
    // 1. 端点路径解析 (逻辑不变)
    let finalEndpointPath;
    const endpointPaths = sourceConfig.endpoint_paths;
    if (endpointPaths && typeof endpointPaths === 'object') {
      if (endpointPaths.fields && endpointPaths.fields[endpointKey] && endpointPaths.fields[endpointKey].stringValue) {
        finalEndpointPath = endpointPaths.fields[endpointKey].stringValue;
      } else if (endpointPaths.properties && endpointPaths.properties[endpointKey] && endpointPaths.properties[endpointKey].stringValue) {
        finalEndpointPath = endpointPaths.properties[endpointKey].stringValue;
      } else if (endpointPaths[endpointKey] && typeof endpointPaths[endpointKey] === 'string') {
        finalEndpointPath = endpointPaths[endpointKey];
      }
    }
    if (typeof finalEndpointPath !== 'string') throw new Error(`无效的数据源配置或端点键 '${endpointKey}'。`);
    
    let finalUrl = `${sourceConfig.base_url}${finalEndpointPath}`;
    const options = { muteHttpExceptions: true };
    
    // 2. 决定HTTP方法 (逻辑不变)
    const methodOverrides = sourceConfig.http_method_override || {};
    options.method = (methodOverrides[endpointKey] || sourceConfig.request_method || 'GET').toLowerCase();

    // 3. 参数处理 (核心修改)
    const allParams = { ...(sourceConfig.fixed_query_params || {}), ...dynamicParams };
    
    // ✅ ================== 新增：配置化时间范围处理 START ==================
    const timeParamName = sourceConfig.time_filter_param_name;
    const lookbackDays = sourceConfig.default_lookback_days;

    if (timeParamName && lookbackDays && !allParams[timeParamName]) {
        const fromDate = new Date();
        fromDate.setDate(fromDate.getDate() - lookbackDays);

        if (timeParamName.includes('=')) { // 处理 Algolia 特殊语法: "numericFilters=created_at_i>"
            allParams[timeParamName] = Math.floor(fromDate.getTime() / 1000);
        } else if (timeParamName === 'created') { // 处理 GitHub 特殊语法: "q=... created:>YYYY-MM-DD"
            const dateString = fromDate.toISOString().split('T')[0];
            if(allParams['q']) {
                allParams['q'] += ` created:>${dateString}`;
            } else {
                allParams['q'] = `created:>${dateString}`; // 如果q参数为空，直接赋值
            }
        } else { // 处理标准参数: "from=YYYY-MM-DD" 或 "after_date=YYYY-MM-DD"
            allParams[timeParamName] = fromDate.toISOString().split('T')[0];
        }
    }
    // ✅ =================== 新增：配置化时间范围处理 END ===================

    const mappedParams = {};
    const paramNameMap = { ...(sourceConfig.dynamic_param_names || {}), ...(sourceConfig.pagination_param_names || {}) };
    
    for (const key in allParams) {
        // 特殊处理 Algolia 的 numericFilters
        if (key.includes('=')) {
            const parts = key.split('=');
            mappedParams[parts[0]] = `${parts[1]}${allParams[key]}`;
        } else {
            const mappedKey = paramNameMap[key] || key;
            mappedParams[mappedKey] = allParams[key];
        }
    }

    if (options.method === 'get') {
      const queryString = Object.keys(mappedParams).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(mappedParams[key])}`).join('&');
      if (queryString) finalUrl += `?${queryString}`;
    } else {
      options.contentType = 'application/json';
      options.payload = JSON.stringify(mappedParams);
    }
    
    // 4. 请求头与认证 (逻辑不变)
    options.headers = { ...(sourceConfig.request_headers || {}), ...(extraOptions.headers || {}) };
    if (!options.headers['User-Agent']) options.headers['User-Agent'] = 'DeepdiveEngine/1.0 (Google Apps Script)';
    
    if (sourceConfig.auth_method === 'bearer_token' && sourceConfig.apiKey) {
        options.headers['Authorization'] = `Bearer ${sourceConfig.apiKey}`;
    } else if (sourceConfig.auth_method === 'header_key' && sourceConfig.api_key_header_name && sourceConfig.apiKey) {
        options.headers[sourceConfig.api_key_header_name] = sourceConfig.apiKey;
    } else if (sourceConfig.auth_method === 'query_param_key' && sourceConfig.api_key_query_param_name && sourceConfig.apiKey) {
        finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${encodeURIComponent(sourceConfig.api_key_query_param_name)}=${encodeURIComponent(sourceConfig.apiKey)}`;
    }
    
    // 5. 执行请求与响应处理 (逻辑不变)
    const response = UrlFetchApp.fetch(finalUrl, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
        if (sourceConfig.response_type === 'json') {
            try { return JSON.parse(responseText); }
            catch (e) { throw new Error(`响应解析失败 (JSON): ${e.message}`); }
        }
        return responseText;
    } else {
        throw new Error(`API 请求失败 (${sourceConfig.display_name} - ${responseCode}): ${responseText}`);
    }
  },

  //==========================================================================
  // AI MODEL CALL WRAPPERS
  //==========================================================================
  
  /**
   * 健壮的JSON解析函数，尝试处理LLM可能返回的额外字符或双重转义。
   * @param {string} jsonString - 可能是JSON格式的字符串。
   * @returns {object} 解析后的JSON对象。
   * @throws {Error} 如果无法解析为有效的JSON。
   */
  _robustJsonParse: function(jsonString) {
    if (!jsonString || typeof jsonString !== 'string') {
      throw new Error("传入 _robustJsonParse 的输入必须是非空字符串。");
    }
    
    let cleanedString = jsonString.trim();

    // 1. 移除常见的Markdown代码块围栏 (例如, ```json\n...\n```)
    if (cleanedString.startsWith('```json')) {
      cleanedString = cleanedString.substring('```json'.length);
    } else if (cleanedString.startsWith('```')) { // 通用Markdown围栏
      cleanedString = cleanedString.substring('```'.length);
    }
    if (cleanedString.endsWith('```')) {
      cleanedString = cleanedString.substring(0, cleanedString.length - '```'.length);
    }
    cleanedString = cleanedString.trim(); // 移除围栏后再次修剪

    // 2. 移除所有非可打印的ASCII字符 (除了常见的空白字符如空格、制表符、换行符、回车符、换页符)
    // 这有助于清理可能破坏JSON解析的不可见字符。
    cleanedString = cleanedString.replace(/[^\x20-\x7E\n\r\t\f]/g, ''); 

    try {
      // 尝试第一次解析
      const parsedResult = JSON.parse(cleanedString);

      // 如果第一次解析的结果仍然是字符串，则可能是双重转义的JSON。
      // 例如：`content: "{\"key\": \"value\"}"` 而不是 `content: {"key": "value"}`
      if (typeof parsedResult === 'string') {
        Logger.log(`[DataConnector._robustJsonParse] 第一次解析结果为字符串。尝试第二次解析，假定为双重转义。`);
        return JSON.parse(parsedResult); // 尝试解析字符串结果
      }
      return parsedResult; // 如果已经是对象/数组，则直接返回。
    } catch (e) {
      // 记录更多关于失败的详细信息以便调试
      Logger.log(`[DataConnector._robustJsonParse] 最终JSON解析失败。错误: ${e.message}。尝试解析的字符串 (截断至500字符): "${cleanedString.substring(0, Math.min(cleanedString.length, 500))}..."`);
      throw new Error(`AI响应内容无法被解析为有效的JSON。请检查AI输出格式。`);
    }
  },

  /**
   * 调用AI模型进行批处理聊天补全。现在是真正的异步函数。
   */
  getBatchCompletions: async function(promptTemplate, context) {
      let finalPrompt = promptTemplate;
      for (const key in context) {
        finalPrompt = finalPrompt.replace(new RegExp(`{${key}}`, 'g'), context[key]);
      }

      try {
        const llmConfig = this.getSourceConfig('llm_service', 'OPENAI_API'); 
        const modelName = llmConfig.default_chat_model || "gpt-4o-mini";
        const payload = {
          model: modelName,
          messages: [{ role: "user", content: finalPrompt }],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 8000
        };
        
        const responseJson = await this.fetchExternalData(llmConfig, 'chat_completions', payload);

        const choice = responseJson?.choices?.[0];
        if (choice && choice.finish_reason === 'content_filter') {
          throw new Error("AI请求因内容安全策略被阻止。");
        }
        
        const aiContent = choice?.message?.content;

        if (typeof aiContent === 'string' && aiContent.trim() !== '') {
          return this._robustJsonParse(aiContent);
        } else {
          Logger.log(`[DataConnector.getBatchCompletions] 错误：AI响应内容无效或为空。`);
          Logger.log(`[DataConnector.getBatchCompletions] 原始响应: ${JSON.stringify(responseJson)}`);
          throw new Error("AI响应格式不正确或为空 (missing or invalid content field)。");
        }
      } catch (e) {
        // [核心修正] 在抛出错误前，先记录原始错误信息，以便调试
        Logger.log(`[DataConnector.getBatchCompletions] AI批处理分析失败的原始错误: ${e.toString()}`);
        throw new Error(`AI批处理分析失败: ${e.message}`);
      }
  },
  
  /**
   * 为一批文本获取嵌入向量 (真正的异步函数)。
   */
  getBatchEmbeddings: async function(texts) {
    if (!texts || texts.length === 0) return [];
    try {
      const llmConfig = this.getSourceConfig('llm_service', 'OPENAI_API');
      const modelName = llmConfig.default_embedding_model || "text-embedding-3-small";
      const payload = { input: texts, model: modelName };
      
      const responseJson = await this.fetchExternalData(llmConfig, 'embeddings', payload);

      if (responseJson && responseJson.data && Array.isArray(responseJson.data)) {
          responseJson.data.sort((a, b) => a.index - b.index);
          return responseJson.data.map(item => item.embedding);
      }
      return new Array(texts.length).fill(null);
    } catch (e) {
      throw new Error(`AI批量嵌入生成失败: ${e.message}`);
    }
  }
};
