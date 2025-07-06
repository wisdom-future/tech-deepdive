// 文件名: backend/svc.DataConnector.gs

const DataConnector = {
  _sourceCache: {}, // 内部缓存，避免频繁查询 Firestore

  /**
   * 清除缓存（例如在配置更新后调用）
   */
  clearCache: function() {
    this._sourceCache = {};
    Logger.log("[DataConnector] Source cache cleared.");
  },

  /**
   * 获取单个数据源配置。
   * @param {string} sourceType - 期望的数据源类型 (e.g., 'news_source')
   * @param {string} [sourceId=null] - 可选：指定特定的数据源ID
   * @returns {object} 数据源配置对象
   */
  getSourceConfig: function(sourceType, sourceId = null) {
    const cacheKey = sourceId ? `${sourceType}_${sourceId}` : `${sourceType}_single_priority`;
    if (this._sourceCache[cacheKey]) {
      Logger.log(`[DataConnector] Returning single source '${cacheKey}' from cache.`);
      return this._sourceCache[cacheKey];
    }

    const allSources = DataService.getDataAsObjects('EXTERNAL_DATA_SOURCES');

    if (!allSources || allSources.length === 0) {
      throw new Error(`未在 Firestore 中找到任何外部数据源配置。`);
    }

    let targetSource = null;
    if (sourceId) {
      targetSource = allSources.find(s => s.is_active && s.id === sourceId);
    } else {
      const activeSources = allSources.filter(s => s.is_active && s.source_type === sourceType);
      if (activeSources.length === 0) {
        throw new Error(`未找到类型为 '${sourceType}' 的活跃外部数据源。`);
      }
      activeSources.sort((a, b) => (b.priority || 0) - (a.priority || 0));
      targetSource = activeSources[0];
    }

    if (!targetSource) {
      throw new Error(`未找到指定ID '${sourceId}' 或类型 '${sourceType}' 的活跃外部数据源。请检查 Firestore 中的 'id' 和 'source_type' 字段是否正确。`);
    }

    if (targetSource.api_key_name) {
      const apiKey = PropertiesService.getScriptProperties().getProperty(targetSource.api_key_name);
      if (!apiKey) {
        throw new Error(`数据源 '${targetSource.display_name}' 的 API Key 未配置 (键名: ${targetSource.api_key_name})。`);
      }
      targetSource.apiKey = apiKey;
    }
    
    targetSource.source_id = targetSource.id;

    this._sourceCache[cacheKey] = targetSource;
    return targetSource;
  },

  /**
   * 获取所有活跃的、指定类型的数据源配置。
   * @param {string} sourceType - 期望的数据源类型
   * @returns {Array<object>}
   */
  getAllActiveSourcesOfType: function(sourceType) {
    const cacheKey = `${sourceType}_all_active`;
    if (this._sourceCache[cacheKey]) {
      Logger.log(`[DataConnector] Returning all active sources for '${sourceType}' from cache.`);
      return this._sourceCache[cacheKey];
    }

    const allSources = DataService.getDataAsObjects('EXTERNAL_DATA_SOURCES');
    if (!allSources || allSources.length === 0) {
      return [];
    }

    const activeSources = allSources.filter(s => s.is_active && s.source_type === sourceType);
    if (activeSources.length === 0) {
      return [];
    }

    const sourcesWithKeys = activeSources.map(source => {
      const enrichedSource = { ...source, source_id: source.id };

      if (enrichedSource.api_key_name) {
        const apiKey = PropertiesService.getScriptProperties().getProperty(enrichedSource.api_key_name);
        if (!apiKey) {
          Logger.log(`[DataConnector] WARNING: 数据源 '${enrichedSource.display_name}' (ID: ${enrichedSource.id}) 的 Key 未配置，将跳过此源。`);
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

  fetchExternalData: function(sourceConfig, endpointKey, dynamicParams, extraOptions = {}) {
    // 防御性解析代码
    ['endpoint_paths', 'fixed_query_params', 'request_headers', 'pagination_param_names', 'dynamic_param_names'].forEach(key => {
      if (sourceConfig[key] && typeof sourceConfig[key] === 'string') {
        try {
          sourceConfig[key] = JSON.parse(sourceConfig[key]);
        } catch (e) {
          Logger.log(`[DataConnector] WARNING: 无法解析字段 '${key}' 的JSON字符串，将视为空对象。值: "${sourceConfig[key]}"`);
          sourceConfig[key] = {};
        }
      }
    });

    if (!sourceConfig || !sourceConfig.base_url || !sourceConfig.endpoint_paths || typeof sourceConfig.endpoint_paths !== 'object' || !sourceConfig.endpoint_paths[endpointKey]) {
      throw new Error(`无效的数据源配置或端点键 '${endpointKey}'。`);
    }

    let finalUrl = `${sourceConfig.base_url}${sourceConfig.endpoint_paths[endpointKey]}`;
    const options = { muteHttpExceptions: true };

    // 1. 从固定参数开始
    const allQueryParams = { ...(sourceConfig.fixed_query_params || {}) };
    
    // 2. 只有当是 GET 请求时，才处理动态参数
    if (sourceConfig.request_method === 'GET' && dynamicParams) {
      // 遍历从工作流传来的每一个动态参数 (genericKey 是通用名，如 'q', 'pageSize')
      for (const genericKey in dynamicParams) {
        let specificKey = genericKey; // 默认为通用名
        const specificValue = dynamicParams[genericKey];

        // 检查分页参数映射
        if (genericKey === 'pageSize' && sourceConfig.pagination_param_names?.pageSize) {
          specificKey = sourceConfig.pagination_param_names.pageSize;
        } 
        else if (genericKey === 'pageNumber' && sourceConfig.pagination_param_names?.pageNumber) {
          specificKey = sourceConfig.pagination_param_names.pageNumber;
        }
        // 检查其他动态参数映射
        else if (sourceConfig.dynamic_param_names && sourceConfig.dynamic_param_names[genericKey]) {
          specificKey = sourceConfig.dynamic_param_names[genericKey];
        }
        
        // 将映射后的键和值添加到最终参数对象中
        allQueryParams[specificKey] = specificValue;
      }
    }

    const queryString = Object.keys(allQueryParams)
      .map(key => `${encodeURIComponent(key)}=${encodeURIComponent(allQueryParams[key])}`)
      .join('&');

    if (queryString) {
      finalUrl += `?${queryString}`;
    }

    options.method = (sourceConfig.request_method || 'GET').toLowerCase();
    options.headers = { ...(sourceConfig.request_headers || {}), ...(extraOptions.headers || {}) };

    if (!options.headers['User-Agent']) {
      options.headers['User-Agent'] = 'DeepdiveEngine/1.0 (Google Apps Script)';
    }

    if (sourceConfig.auth_method === 'header_key' && sourceConfig.api_key_header_name && sourceConfig.apiKey) {
      options.headers[sourceConfig.api_key_header_name] = sourceConfig.apiKey;
    } else if (sourceConfig.auth_method === 'bearer_token' && sourceConfig.api_key_header_name && sourceConfig.apiKey) {
      options.headers[sourceConfig.api_key_header_name] = `Bearer ${sourceConfig.apiKey}`;
    } else if (sourceConfig.auth_method === 'query_param_key' && sourceConfig.api_key_query_param_name && sourceConfig.apiKey) {
      finalUrl += `${finalUrl.includes('?') ? '&' : '?'}${encodeURIComponent(sourceConfig.api_key_query_param_name)}=${encodeURIComponent(sourceConfig.apiKey)}`;
    }

    if (options.method !== 'get' && dynamicParams) {
      if (sourceConfig.payload_type === 'json') {
        options.contentType = 'application/json';
        options.payload = JSON.stringify(dynamicParams);
      } else if (sourceConfig.payload_type === 'form_urlencoded') {
        options.contentType = 'application/x-www-form-urlencoded';
        options.payload = Object.keys(dynamicParams).map(key => `${encodeURIComponent(key)}=${encodeURIComponent(dynamicParams[key])}`).join('&');
      }
    }

    Object.assign(options, extraOptions);

    Logger.log(`[DataConnector] Fetching from ${sourceConfig.display_name} (URL: ${finalUrl.substring(0, 200)}...)`);
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
  }
};
