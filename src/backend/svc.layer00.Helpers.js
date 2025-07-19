/**
 * @file layer00.Helpers.gs
 * @description 提供无状态的、可被全局复用的辅助函数。
 * 继承并重组了原 utils.gs 的所有功能。
 */

//==================================================================
// 模块 1: DataMapper - 负责原始数据到标准格式的映射
//==================================================================
const DataMapper = {
  
  /**
   * 根据映射规则，将从API获取的【单个】原始条目转换为系统内部的标准对象。
   * @param {object|XmlService.XmlElement} rawItem - 单个原始条目。
   * @param {Object} mappingRules - 来自数据源配置的 response_mapping_rules。
   * @param {string} responseType - 响应类型 ('json' 或 'xml')。
   * @returns {Object|null} 转换后的标准对象。
   */
  map: function(rawItem, mappingRules, responseType) {
    if (!rawItem || !mappingRules || !mappingRules.fields) {
      Logger.log("[DataMapper.map] 映射失败：输入数据或映射规则无效。");
      return null;
    }

    const standardItem = {};
    const atomNamespace = XmlService.getNamespace('http://www.w3.org/2005/Atom');

    for (const standardField in mappingRules.fields) {
      const sourcePath = mappingRules.fields[standardField];
      let extractedValue = null;

      if (responseType === 'xml') {
        if (typeof rawItem.getChild !== 'function') {
           Logger.log(`[DataMapper.map] ERROR: 预期的 rawItem 是一个 XmlElement，但收到了类型 ${typeof rawItem}。`);
           return null;
        }
        extractedValue = this._getXmlValueFromPath(rawItem, sourcePath, atomNamespace);
        if (standardField === 'publication_date' && extractedValue) {
            extractedValue = new Date(extractedValue);
        }
      } else { // JSON
        extractedValue = this._getValueFromPath(rawItem, sourcePath);
      }
      standardItem[standardField] = extractedValue;
    }

    // 统一处理ID
    standardItem.id = this._extractId(rawItem, mappingRules, responseType, atomNamespace);

    // 统一处理URL
    if (!standardItem.url || typeof standardItem.url !== 'string' || !standardItem.url.startsWith('http')) {
        const searchText = standardItem.title || standardItem.id || '';
        standardItem.url = `https://www.google.com/search?q=${encodeURIComponent(searchText)}`;
    }
    
    return standardItem;
  },

  getRawItems: function(responseData, itemsPath, responseType) {
    if (!responseData) return [];
    if (responseType === 'xml') {
        try {
            // [最终修正] 清洗XML文本，移除可能导致解析失败的BOM头等不可见字符
            const cleanedXml = responseData.trim().replace(/^[\u200B-\u200D\uFEFF]/, "");
            if (!cleanedXml) {
                Logger.log(`[DataMapper.getRawItems] WARN: Cleaned XML response is empty.`);
                return [];
            }
            const xmlDoc = XmlService.parse(cleanedXml);
            const root = xmlDoc.getRootElement();
            const atomNamespace = XmlService.getNamespace('http://www.w3.org/2005/Atom');
            const entries = root.getChildren(itemsPath, atomNamespace);
            
            // [诊断日志] 检查是否真的没有找到条目
            if (!entries || entries.length === 0) {
                // 如果找不到 'entry'，检查返回的XML中是否包含错误信息
                const errorNode = root.getChild('error', atomNamespace) || root.getChild('error');
                if (errorNode) {
                    Logger.log(`[DataMapper.getRawItems] WARN: arXiv API returned an error message: ${errorNode.getText()}`);
                } else {
                    Logger.log(`[DataMapper.getRawItems] INFO: Successfully parsed XML, but no '${itemsPath}' elements were found.`);
                }
                return [];
            }
            return entries;
        } catch (e) {
            Logger.log(`[DataMapper.getRawItems] ERROR: XML解析失败. ${e.message}. Raw XML (first 500 chars): ${responseData.substring(0, 500)}`);
            return [];
        }
    } else { // JSON
        let parsedData = (typeof responseData === 'string') ? JSON.parse(responseData) : responseData;
        if (itemsPath === '.' || !itemsPath) {
            return Array.isArray(parsedData) ? parsedData : [];
        }
        const items = this._getValueFromPath(parsedData, itemsPath);
        return Array.isArray(items) ? items : [];
    }
  },
  
  // --- Private Helpers for DataMapper ---
  
  _getValueFromPath: function(obj, path) {
    if (!obj || typeof path !== 'string') return null;
    if (path === '.') return obj;
    return path.split('.').reduce((acc, part) => (acc && acc.hasOwnProperty(part)) ? acc[part] : null, obj);
  },

  _getXmlValueFromPath: function(xmlElement, path, ns) {
      if (!xmlElement || !path || typeof xmlElement.getChild !== 'function') return null;
      let currentElement = path.split('.').reduce((el, part) => el ? el.getChild(part, ns) : null, xmlElement);
      return currentElement ? currentElement.getText() : null;
  },

  _extractId: function(rawItem, mappingRules, responseType, ns) {
    if (rawItem.id) return rawItem.id;
    if (responseType === 'xml') {
      const idElement = rawItem.getChild('id', ns);
      return idElement ? idElement.getText()?.split('/').pop() : Helpers.generateUuid();
    }
    const mappedIdPath = mappingRules.fields.id;
    return mappedIdPath ? this._getValueFromPath(rawItem, mappedIdPath) : Helpers.generateUuid();
  }
};


//==================================================================
// 模块 2: Helpers - 独立的、通用的辅助函数
//==================================================================
const Helpers = {
  
  normalizeForId: function(name) {
    if (!name || typeof name !== 'string' || name.trim().length === 0) {
      // ✅ 如果名称无效，返回一个带有时间戳的唯一标识，而不是空字符串
      return `invalid_name_${new Date().getTime()}`;
    }
    let normalized = name.trim().toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '') // 移除大部分特殊字符
      .replace(/[\s-]+/g, '_');    // 将空格和连字符替换为下划线
      
    // ✅ 确保结果不是空的或只有下划线
    if (!normalized || normalized.replace(/_/g, '').length === 0) {
      return `normalized_to_empty_${new Date().getTime()}`;
    }
    return normalized;
  },

  generateUuid: function() {
    return Utilities.getUuid();
  },

  generateHash: function(text) {
    if(!text) return null;
    const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(text));
    return bytes.map(byte => (byte < 0 ? byte + 256 : byte).toString(16).padStart(2, '0')).join('');
  },

  createTasksFromItems: function(rawItems, taskType, sourceId, triggerEntityId, sourceConfig) {
    if (!rawItems || !Array.isArray(rawItems) || rawItems.length === 0) return 0;
    
    const tasksToQueue = rawItems.map(rawItem => {
      try {
        const mappedItem = DataMapper.map(rawItem, sourceConfig.response_mapping_rules, sourceConfig.response_type);
        if (!mappedItem) return null;
        
        return {
          id: `task_${this.generateUuid()}`,
          task_type: taskType,
          task_status: 'PENDING',
          payload: { ...mappedItem, trigger_entity_id: triggerEntityId },
          source_id: sourceId,
          created_timestamp: new Date(),
          retry_count: 0
        };
      } catch (e) {
        Logger.log(`ERROR: Failed to map raw item. ${e.message}`);
        return null;
      }
    }).filter(Boolean);

    if (tasksToQueue.length > 0) {
      DataService.batchUpsert('QUEUE_TASKS', tasksToQueue, 'id');
      return tasksToQueue.length;
    }
    return 0;
  },

  /**
   * 统一的辅助函数：根据实体类型，提取用于外部搜索的关键词列表。
   * 这个函数会智能地从 `search_keywords` 或 `tech_keywords` 中获取数据。
   *
   * @param {Object} entity - 实体对象。
   * @returns {string[]} 关键词字符串数组。
   */
  getSearchKeywordsForEntity: function(entity) {
      if (!entity) return [];
      let keywords = [];

      // 1. 优先使用 `search_keywords` 字段 (AI 丰富后会生成，类型为数组)
      if (entity.search_keywords && Array.isArray(entity.search_keywords) && entity.search_keywords.length > 0) {
          keywords.push(...entity.search_keywords);
      }
      // 2. 如果是 Technology 实体，且没有 `search_keywords`，则使用 `tech_keywords` (旧数据格式，逗号分隔字符串)
      else if (entity.entity_type === 'Technology' && entity.tech_keywords && typeof entity.tech_keywords === 'string') {
          keywords.push(...entity.tech_keywords.split(',').map(k => k.trim()).filter(Boolean));
      }
      // 3. 回退到 `primary_name` 和 `aliases`
      else {
          if (entity.primary_name) keywords.push(entity.primary_name);
          if (entity.aliases && Array.isArray(entity.aliases)) {
              keywords.push(...entity.aliases);
          }
          // 对于 Company 实体，如果前面都没找到，可以考虑加上 stock_symbol
          if (entity.entity_type === 'Company' && entity.stock_symbol) {
              keywords.push(entity.stock_symbol);
          }
      }
      
      // 返回去重且非空的关键词
      return [...new Set(keywords.filter(Boolean).map(k => String(k).trim()))];
  }
};


//==================================================================
// 模块 3: DateUtils - 独立的、通用的日期处理工具
//==================================================================
const DateUtils = {
  formatDate: function(dateValue, includeTime = false, formatString = null) {
    if (!dateValue) return 'N/A';
    let dateObj = (dateValue instanceof Date) ? dateValue : new Date(dateValue);
    if (isNaN(dateObj.getTime())) return String(dateValue);
    const format = formatString || (includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
  },

  parseDate: function(dateString) {
    if (!dateString) return null;
    if (dateString instanceof Date) return dateString;
    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) return null;
    return dateObj;
  }
};


//==================================================================
// 模块 4: Logging - 独立的、分级别的日志记录器
//==================================================================
const Logging = {
  debug: function(message) {
    if (CONFIG.ENVIRONMENT.LOG_LEVEL === 'DEBUG') {
      Logger.log(`[DEBUG] ${message}`);
    }
  },
  info: function(message) {
    if (CONFIG.ENVIRONMENT.LOG_LEVEL === 'DEBUG' || CONFIG.ENVIRONMENT.LOG_LEVEL === 'INFO') {
      Logger.log(`[INFO] ${message}`);
    }
  },
  warn: function(message) {
    if (CONFIG.ENVIRONMENT.LOG_LEVEL !== 'ERROR') {
      Logger.log(`[WARN] ${message}`);
    }
  },
  error: function(message) {
    Logger.log(`[ERROR] ${message}`);
  }
};

//==================================================================
// 模块 5: PropertyTools - 用于导入/导出脚本属性的开发工具
// 注意：这些函数应在开发环境中手动执行，不应被线上业务逻辑调用
//==================================================================
const PropertyTools = {
  exportScriptProperties: function() {
    const properties = PropertiesService.getScriptProperties().getProperties();
    const jsonString = JSON.stringify(properties, null, 2);
    Logger.log("请复制下面的所有内容以备份脚本属性：");
    Logger.log(jsonString);
  },

  importScriptProperties: function(jsonString) {
    try {
      const propertiesToSet = JSON.parse(jsonString);
      if (Object.keys(propertiesToSet).length === 0) {
        Logger.log("JSON数据为空或无效，没有属性被导入。");
        return;
      }
      // 这是一个危险操作，建议在执行前先导出备份
      // PropertiesService.getScriptProperties().deleteAllProperties(); 
      PropertiesService.getScriptProperties().setProperties(propertiesToSet, false);
      Logger.log(`成功导入 ${Object.keys(propertiesToSet).length} 个属性。`);
    } catch (e) {
      Logger.log(`导入失败：${e.toString()}`);
    }
  }
};
