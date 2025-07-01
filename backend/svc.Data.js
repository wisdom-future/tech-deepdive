/** @global CONFIG */
/** @global CacheService */
/** @global SpreadsheetApp */
/** @global DateUtils */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

/**
 * @file 数据访问层服务，封装所有对Google Sheets的直接操作。
 * 这是系统中唯一应该直接与SpreadsheetApp交互的地方。
 * 版本：6.0 - 最终版，包含可安全切换的缓存机制，并兼容所有现有函数。
 */
const DataService = {

  // ==================================================================================
  //  缓存开关：在开发时设为 false，上线前设为 true
  // ==================================================================================
  _USE_CACHE: true, // Changed to true for production performance

  /**
   * 从指定的Google Sheet获取所有数据，并根据开关使用缓存。
   */
  getSheetData(dbId, sheetName) {
    if (!dbId || !sheetName) {
      throw new Error("DataService.getSheetData: dbId 和 sheetName 不能为空。");
    }

    const cacheKey = `SHEET_DATA_${dbId}_${sheetName}`;

    // Only use cache if enabled
    if (this._USE_CACHE) {
      const cache = CacheService.getScriptCache();

      // In DEVELOPMENT mode, always clear cache for fresh data
      if (CONFIG.ENV === 'DEVELOPMENT') {
        cache.remove(cacheKey);
        logDebug(`[DataService] Cache cleared for ${cacheKey} (DEVELOPMENT mode).`);
      }

      const cached = cache.get(cacheKey);
      if (cached !== null) {
        logDebug(`[DataService] Cache hit for ${cacheKey}.`);
        return JSON.parse(cached);
      }
      logDebug(`[DataService] Cache miss for ${cacheKey}. Fetching from Sheet.`);
    }

    // Core logic to read data from Google Sheet
    try {
      const spreadsheet = SpreadsheetApp.openById(dbId);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found in DB`);
      }
      
      const data = sheet.getDataRange().getValues();
      
      if (!data || data.length === 0) {
          logDebug(`[DataService] No data found in sheet: ${sheetName}.`);
          return [];
      }

      // Only write to cache if enabled
      if (this._USE_CACHE) {
        const cache = CacheService.getScriptCache();
        cache.put(cacheKey, JSON.stringify(data), CONFIG.PERFORMANCE.CACHE_DURATION_SECONDS);
        logDebug(`[DataService] Data for ${cacheKey} cached for ${CONFIG.PERFORMANCE.CACHE_DURATION_SECONDS} seconds.`);
      }
       
      return data;

    } catch (e) {
      const errorMessage = `无法访问工作表: '${sheetName}'. 根本原因: ${e.message}`;
      logError(`[DataService] 获取工作表数据失败 [${sheetName}]: ${errorMessage} \n ${e.stack}`);
      throw new Error(errorMessage);
    }
  },

  /**
   * 将包含双行表头的二维数组转换为结构化的对象数组。
   * (此函数与你的版本完全兼容)
   */
  _mapArrayToObject(data) {
    if (!data || !Array.isArray(data) || data.length < 2) {
      return { objects: [], headers: { eng: [], cn: [] } };
    }
    const engHeaders = data[0].map(h => String(h || '').trim());
    const cnHeaders = data[1].map(h => String(h || '').trim());
    const rows = data.length > 2 ? data.slice(2) : [];
    const validEngHeaders = [];
    const validCnHeaders = [];
    const validIndices = [];
    engHeaders.forEach((header, index) => {
      if (header) {
        validEngHeaders.push(header);
        validCnHeaders.push(cnHeaders[index] || header);
        validIndices.push(index);
      }
    });
    if (validEngHeaders.length === 0) {
        return { objects: [], headers: { eng: [], cn: [] } };
    }
    const objects = rows.map(row => {
      if (!row || !Array.isArray(row)) return null;
      const obj = {};
      let hasValue = false;
      validIndices.forEach((dataIndex, headerIndex) => {
        const key = validEngHeaders[headerIndex];
        const value = (row && dataIndex < row.length) ? row[dataIndex] : undefined;
        obj[key] = value;
        if (value !== undefined && value !== null && String(value).trim() !== '') hasValue = true;
      });
      return hasValue ? obj : null;
    }).filter(Boolean);
    return {
      objects: objects,
      headers: { eng: validEngHeaders, cn: validCnHeaders }
    };
  },

  /**
   * 公开的、获取结构化数据的主要方法。
   * (此函数与你的版本完全兼容)
   */
  getDataAsObjects(dbId, sheetName) {
    const rawData = this.getSheetData(dbId, sheetName);
    const result = this._mapArrayToObject(rawData);

    // **核心调试日志：打印所有读取到的 created_timestamp 值，受LOG_LEVEL控制**
    if (CONFIG.LOG_LEVEL === 'DEBUG' && sheetName === CONFIG.SHEET_NAMES.RAW_TECH_NEWS && result.objects.length > 0) {
        logDebug(`DEBUG_DATASRV_MAPPED_ALL_CREATED_TIMESTAMPS for ${sheetName} (total ${result.objects.length} records):`);
        const allCreatedTimestamps = result.objects.map(obj => obj.created_timestamp);
        logDebug(JSON.stringify(allCreatedTimestamps.slice(0,10)) + (allCreatedTimestamps.length > 10 ? '...' : '')); // Limit log output
    }
    // **调试日志结束**

    return result.objects;
  },

  /**
   * 获取指定表的表头映射关系。
   * (此函数与你的版本完全兼容)
   */
  getHeaderMapping(dbId, sheetName) {
    const rawData = this.getSheetData(dbId, sheetName);
    const result = this._mapArrayToObject(rawData);
    const mapping = {};
    result.headers.eng.forEach((engHeader, index) => {
      mapping[engHeader] = result.headers.cn[index];
    });
    return mapping;
  },

  /**
   * ✅ 最终的、最可靠的实现方式
   */
  getDataWithSelectedColumns: function(dbId, sheetName, columnNames) {
    try {
      // 1. 先用已经验证过的方法，获取所有数据
      const allObjects = this.getDataAsObjects(dbId, sheetName);
      if (!allObjects || allObjects.length === 0) return [];
      
      // 2. 在内存中进行筛选，这比操作表格API更安全、更快速
      return allObjects.map(fullObject => {
        const newObj = {};
        columnNames.forEach(key => {
          // 如果原始对象中有这个键，就复制过来
          if (fullObject.hasOwnProperty(key)) {
            newObj[key] = fullObject[key];
          }
        });
        return newObj;
      });
    } catch (e) {
      logError(`[DataService] 从 "${sheetName}" 获取指定列 [${columnNames.join(',')}] 数据时出错: ${e.message}\n${e.stack}`);
      throw new Error(`从 "${sheetName}" 获取指定列 [${columnNames.join(',')}] 数据时出错: ${e.message}`);
    }
  },

  /**
   * 专门用于获取最新的、有限行数的数据。
   * (此函数与你的版本完全兼容)
   */
  getLatestDataAsObjects(dbId, sheetName, dataRowsToFetch = 100) {
    try {
      const spreadsheet = SpreadsheetApp.openById(dbId);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        throw new Error(`Sheet "${sheetName}" not found in DB`);
      }
      const lastColumn = sheet.getLastColumn();
      const totalRowsInSheet = sheet.getLastRow();
      const rowsToRead = 2 + dataRowsToFetch; // 2 for headers, plus data rows
      const effectiveRowsToRead = Math.min(rowsToRead, totalRowsInSheet);
      if (effectiveRowsToRead < 2) { // Need at least 2 rows for headers
        logDebug(`[DataService] Not enough rows in sheet ${sheetName} for getLatestDataAsObjects. Total: ${totalRowsInSheet}.`);
        return [];
      }
      // Read from the actual start of data, or from the bottom up if reading fewer than total
      // This logic attempts to read the last 'dataRowsToFetch' rows, plus the 2 header rows.
      // It ensures that if the sheet has fewer than (dataRowsToFetch + 2) rows, it reads all of them.
      const startRow = Math.max(1, totalRowsInSheet - dataRowsToFetch); 
      const range = sheet.getRange(startRow, 1, totalRowsInSheet - startRow + 1, lastColumn);

      const rawData = range.getValues();
      const result = this._mapArrayToObject(rawData);
      return result.objects;
    } catch (e) {
      logError(`[DataService] 无法从 '${sheetName}' 获取最新数据: ${e.message}\n${e.stack}`);
      throw new Error(`无法从 '${sheetName}' 获取最新数据: ${e.message}`);
    }
  }
};



// ==================================================================================
//  T E S T   C O D E (保持不变，因为这些测试已经通过)
// ==================================================================================

/**
 * 运行所有DataService相关的单元测试。
 * 这是推荐运行的主测试函数。
 */
function test_All_DataService() {
  logInfo("======== 开始运行所有 DataService 测试套件 ========");
  const overallResult = test_DataService_DualHeader();
  logInfo("\n======== 所有 DataService 测试套件运行结束 ========");
  if(overallResult) {
    logInfo("🎉🎉🎉 恭喜! 所有 DataService 测试用例通过! 🎉🎉🎉");
  } else {
    logError("🔥🔥🔥 注意! 部分 DataService 测试用例失败，请仔细检查上方日志。 🔥🔥🔥");
  }
}


/**
 * 核心测试函数，验证双行表头处理及其他逻辑。
 * @returns {boolean} 如果所有测试通过则返回 true，否则返回 false。
 */
function test_DataService_DualHeader() {
  logInfo("======== 开始测试 DataService (双行表头) ========");
  
  let allTestsPassed = true;

  // 测试用例1: 正常获取并解析双行表头数据
  try {
    logInfo("\n--- 测试用例 1: 正常获取 Tech_Intelligence_Master 表 ---");
    const insights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
    
    if (typeof insights === 'undefined') {
        throw new Error("DataService.getDataAsObjects 返回了 undefined。");
    }

    if (insights.length > 0) {
      logInfo(`✅ 成功获取 ${insights.length} 条记录。`);
      const firstRecord = insights[0];
      
      if (firstRecord.hasOwnProperty('intelligence_id') && firstRecord.hasOwnProperty('title')) {
        logInfo("✅ 验证成功: 对象的键名是预期的英文表头。");
        logInfo("第一条记录示例: " + JSON.stringify(firstRecord, null, 2));
      } else {
        throw new Error("对象的键名不是预期的英文表头。得到的键名: " + Object.keys(firstRecord).join(', '));
      }
    } else {
      logInfo("✅ (预期行为) 表中没有数据（第三行以下），函数执行成功。");
    }
  } catch (e) {
    logError(`❌ 测试用例 1 失败: ${e.message} \n ${e.stack}`);
    allTestsPassed = false;
  }

  // 测试用例2: 测试获取表头映射功能
  try {
    logInfo("\n--- 测试用例 2: 获取 Tech_Intelligence_Master 表的表头映射 ---");
    const mapping = DataService.getHeaderMapping(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
    
    if (typeof mapping === 'undefined') {
        throw new Error("DataService.getHeaderMapping 返回了 undefined。");
    }

    // 假设您的中文表头是这些，如果不是请修改
    // 请根据您实际的 Google Sheet 表头内容进行调整
    const expectedIntelligenceIdCn = '情报ID (主键)'; // 根据您的截图，这是实际的表头值
    const expectedTitleCn = '情报标题'; // 请根据您的实际表头调整

    if (mapping && mapping.intelligence_id === expectedIntelligenceIdCn && mapping.title === expectedTitleCn) {
       logInfo(`✅ 成功获取表头映射。示例: 'intelligence_id' -> '${mapping.intelligence_id}'`);
       logInfo("完整映射: " + JSON.stringify(mapping, null, 2));
    } else {
       let errorMsg = "获取表头映射失败或映射不正确。\n";
       errorMsg += `  - 期望 'intelligence_id' 映射到 '${expectedIntelligenceIdCn}', 实际为 '${mapping.intelligence_id}'\n`;
       errorMsg += `  - 期望 'title' 映射到 '${expectedTitleCn}', 实际为 '${mapping.title}'\n`;
       throw new Error(errorMsg);
    }
  } catch (e) {
    logError(`❌ 测试用例 2 失败: ${e.message} \n ${e.stack}`);
    allTestsPassed = false;
  }

  // 测试用例3: 尝试获取一个不存在的表
  try {
    logInfo("\n--- 测试用例 3: 尝试获取一个不存在的表 'Non_Existent_Sheet' ---");
    DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, 'Non_Existent_Sheet');
    throw new Error("函数本应抛出错误但没有。");
  } catch (e) {
    if (e.message.includes("not found in DB")) {
      logInfo(`✅ 成功捕获到预期的 'Sheet not found' 错误。`);
    } else {
      throw new Error(`捕获到非预期的错误: ${e.message}`);
    }
  }

  logInfo("======== DataService (双行表头) 测试结束 ========");
  return allTestsPassed;
}

/**
 * [DEBUG FUNCTION] 用于直接测试 Raw_Competitor_Intelligence 表的数据映射。
 * 运行此函数，然后在 Apps Script 的“执行”日志中查看输出。
 */
function test_CompetitorIntelligenceDataMapping() {
  logInfo("--- 开始测试 Raw_Competitor_Intelligence 数据映射 ---");
  try {
    const dbId = CONFIG.DATABASE_IDS.RAWDATA_DB;
    const sheetName = CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE;
    
    // 尝试获取前5条数据
    const mappedData = DataService.getLatestDataAsObjects(dbId, sheetName, 5);

    if (mappedData && mappedData.length > 0) {
      logInfo(`成功获取 ${mappedData.length} 条记录。`);
      logInfo("第一条记录的键名列表: " + Object.keys(mappedData[0]).join(', '));
      logInfo("第一条记录的完整数据: " + JSON.stringify(mappedData[0], null, 2));

      if (mappedData.length > 1) {
        logInfo("第二条记录的完整数据: " + JSON.stringify(mappedData[1], null, 2));
      }
    } else {
      logInfo("Raw_Competitor_Intelligence 表中没有数据或数据获取失败。");
    }
  } catch (e) {
    logError(`ERROR: 测试 Raw_Competitor_Intelligence 数据映射失败: ${e.message} \n ${e.stack}`);
  }
  logInfo("--- 结束测试 Raw_Competitor_Intelligence 数据映射 ---");
}

/**
 * [DEBUG] 统一测试 ConfigDataService 的所有统计函数
 */
function test_All_ConfigDataService() {
  logInfo("====== 开始测试 ConfigDataService ======");
  try {
    const techStats = ConfigDataService.getTechnologyDomainStats();
    logInfo(`✅ 技术领域统计: ${JSON.stringify(techStats)}`);
  } catch (e) {
    logError(`❌ 获取技术领域统计失败: ${e.message}`);
  }

  try {
    const benchStats = ConfigDataService.getIndustryBenchmarkStats();
    logInfo(`✅ 业界标杆统计: ${JSON.stringify(benchStats)}`);
  } catch (e) {
    logError(`❌ 获取业界标杆统计失败: ${e.message}`);
  }

  try {
    const confStats = ConfigDataService.getConferenceStats();
    logInfo(`✅ 学术顶会统计: ${JSON.stringify(confStats)}`);
  } catch (e) {
    logError(`❌ 获取学术顶会统计失败: ${e.message}`);
  }
  logInfo("====== ConfigDataService 测试结束 ======");
}

function test_All_DataService_Access() {
  logInfo("========== [开始] 数据服务层访问全面测试 ==========");

  let allTestsPassed = true;

  // 1. 定义所有需要测试的数据源
  const sourcesToTest = [
    // --- 来自 Config DB ---
    { dbKey: 'CONFIG_DB', sheetKey: 'TECH_REGISTRY', description: '技术领域注册表' },
    { dbKey: 'CONFIG_DB', sheetKey: 'COMPETITOR_REGISTRY', description: '竞争对手注册表' },
    { dbKey: 'CONFIG_DB', sheetKey: 'CONFERENCE_REGISTRY', description: '学术顶会注册表' },
    
    // --- 来自 Raw Data DB ---
    { dbKey: 'RAWDATA_DB', sheetKey: 'RAW_ACADEMIC_PAPERS', description: '原始学术论文' },
    { dbKey: 'RAWDATA_DB', sheetKey: 'RAW_TECH_NEWS', description: '原始技术新闻' },
    { dbKey: 'RAWDATA_DB', sheetKey: 'RAW_OPENSOURCE_DATA', description: '原始开源数据' },
    
    // --- 来自 Intelligence DB ---
    { dbKey: 'INTELLIGENCE_DB', sheetKey: 'TECH_INSIGHTS_MASTER', description: '核心技术洞察主表' },
    
    // --- 来自 Operations DB ---
    { dbKey: 'OPERATIONS_DB', sheetKey: 'WORKFLOW_LOG', description: '工作流执行日志' },
  ];

  // 2. 遍历并测试每一个数据源
  sourcesToTest.forEach((source, index) => {
    const dbId = CONFIG.DATABASE_IDS[source.dbKey];
    const sheetName = CONFIG.SHEET_NAMES[source.sheetKey];
    const description = source.description;

    logInfo(`\n--- [测试项 ${index + 1}/${sourcesToTest.length}] 正在测试: ${description} ---`);
    
    if (!dbId) {
      logError(`❌ 失败: 在 Config.gs 中未找到数据库ID配置: CONFIG.DATABASE_IDS.${source.dbKey}`);
      allTestsPassed = false;
      return; // 继续下一个测试
    }
    if (!sheetName) {
      logError(`❌ 失败: 在 Config.gs 中未找到工作表名称配置: CONFIG.SHEET_NAMES.${source.sheetKey}`);
      allTestsPassed = false;
      return; // 继续下一个测试
    }

    logInfo(`  - 数据库ID: ${dbId}`);
    logInfo(`  - 工作表名: "${sheetName}"`);

    try {
      // 使用最底层的API进行测试
      const spreadsheet = SpreadsheetApp.openById(dbId);
      if (!spreadsheet) {
        throw new Error("SpreadsheetApp.openById(dbId) 返回了 null，请检查文件ID和权限！");
      }
      
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        throw new Error(`getSheetByName("${sheetName}") 返回了 null，请检查工作表名称是否完全匹配！`);
      }

      // 尝试读取少量数据
      const range = sheet.getRange(1, 1, 2, 3); // 读取A1:C2区域
      const values = range.getValues();
      
      logInfo(`✅ 成功: 成功访问并读取了 "${description}" 的少量数据。`);
      logInfo(`   - A1单元格内容: "${values[0][0]}"`);

    } catch (e) {
      logError(`❌ 失败: 访问 "${description}" 时发生错误: ${e.message}`);
      // 为了更详细的诊断，打印堆栈信息
      logError(e.stack); 
      allTestsPassed = false;
    }
  });

  // 3. 输出最终测试结果
  logInfo("\n========== [结束] 数据服务层访问全面测试 ==========");
  if (allTestsPassed) {
    logInfo("🎉🎉🎉 恭喜！所有配置的数据源均可正常访问！");
  } else {
    logError("🔥🔥🔥 注意！部分数据源访问失败，请仔细检查上方日志中的 '❌ 失败' 信息。");
  }
}