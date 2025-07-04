// 文件名: backend/FirestoreService.gs

/**
 * @file Firestore 数据访问服务 (手动JWT认证模式)
 * @version 5.2 - 优化调试日志版 (针对大数组和embedding字段)
 * 通过手动创建和签名JWT来获取OAuth令牌，绕过部署时的权限验证问题，
 * 并确保在服务器端执行时能忽略Firestore安全规则。
 * 包含了所有必需的 CRUD (创建、读取、更新、删除) 辅助函数。
 */
const FirestoreService = {
  
  // 添加一个唯一的初始化标志，方便调试
  _initialized: (function() {
    Logger.log("[DEBUG_FS_INIT] FirestoreService initialized.");
    return true;
  })(),

  authToken: null,
  tokenExpiration: 0,
  projectId: null,
  
  /**
   * 获取访问令牌。如果令牌不存在或即将过期，则通过JWT流程重新生成。
   * @returns {string} 有效的访问令牌
   */
  _getAuthToken: function() {
    const now = Math.floor(Date.now() / 1000);
    if (this.authToken && this.tokenExpiration > now + 60) {
      Logger.log("使用缓存的Firestore访问令牌。");
      return this.authToken;
    }

    Logger.log("正在通过JWT流程生成新的Firestore访问令牌...");

    const scriptProperties = PropertiesService.getScriptProperties();
    const clientEmail = scriptProperties.getProperty('FIRESTORE_CLIENT_EMAIL');
    const privateKey = scriptProperties.getProperty('FIRESTORE_PRIVATE_KEY');
    this.projectId = scriptProperties.getProperty('FIRESTORE_PROJECT_ID');

    if (!clientEmail || !privateKey || !this.projectId) {
      throw new Error("Firestore 服务账号凭据未在脚本属性中完全配置 (FIRESTORE_CLIENT_EMAIL, FIRESTORE_PRIVATE_KEY, FIRESTORE_PROJECT_ID)。");
    }

    const jwtHeader = { alg: "RS256", typ: "JWT" };
    const claimSet = {
      iss: clientEmail,
      scope: "https://www.googleapis.com/auth/datastore",
      aud: "https://oauth2.googleapis.com/token",
      exp: now + 3600,
      iat: now
    };

    const toSign = Utilities.base64EncodeWebSafe(JSON.stringify(jwtHeader)) + "." + 
                   Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));

    const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey.replace(/\\n/g, '\n'));
    const signature = Utilities.base64EncodeWebSafe(signatureBytes);
    const jwt = toSign + "." + signature;

    const tokenResponse = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", {
      method: "post",
      contentType: "application/x-www-form-urlencoded",
      muteHttpExceptions: true,
      payload: {
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt
      }
    });

    const responseCode = tokenResponse.getResponseCode();
    const responseText = tokenResponse.getContentText();

    if (responseCode < 200 || responseCode >= 300) {
        Logger.log(`获取令牌失败 (${responseCode}): ${responseText}`);
        throw new Error(`获取令牌失败 (${responseCode}): ${responseText}`);
    }

    const tokenData = JSON.parse(responseText);
    this.authToken = tokenData.access_token;
    this.tokenExpiration = now + tokenData.expires_in;
    
    Logger.log("成功生成并缓存了新的访问令牌。");
    return this.authToken;
  },

  /**
   * 封装的底层 API 请求函数
   */
  _request: function(url, method = 'GET', payload = null) {
    const options = {
      method: method.toLowerCase(),
      headers: { "Authorization": "Bearer " + this._getAuthToken() },
      contentType: "application/json",
      muteHttpExceptions: true
    };
    if (payload) { options.payload = JSON.stringify(payload); }
    
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode >= 200 && responseCode < 300) {
      return responseText ? JSON.parse(responseText) : {};
    } else {
      throw new Error(`Firestore API Error (${responseCode}): ${responseText}`);
    }
  },

  /**
   * 调试版本：_wrapFields
   */
  _wrapFields: function(obj) {
      const fields = {};
      for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
              const value = obj[key];
              if (typeof value === 'string') fields[key] = { stringValue: value };
              else if (typeof value === 'number') {
                  if (Number.isInteger(value)) fields[key] = { integerValue: String(value) };
                  else fields[key] = { doubleValue: value };
              }
              else if (typeof value === 'boolean') fields[key] = { booleanValue: value };
              else if (value instanceof Date) fields[key] = { timestampValue: value.toISOString() };
              else if (value === null || value === undefined) fields[key] = { nullValue: null };
              else if (Array.isArray(value)) {
                  fields[key] = { arrayValue: { values: value.map(v => {
                      const wrappedValue = FirestoreService._wrapFields({ temp: v });
                      return wrappedValue.fields.temp;
                  })} };
              }
              else fields[key] = { stringValue: JSON.stringify(value) };
          }
      }
      return { fields };
  },

  /**
   * 调试版本：_unwrapFields (包含详细日志，并优化大数组日志输出)
   */
  _unwrapFields: function(firestoreDoc) {
      // Logger.log("--- DEBUG_UNWRAP_FIELDS_START ---");
      // 注意: Input to _unwrapFields 的完整 JSON 可能会非常大，酌情注释掉
      // Logger.log("Input to _unwrapFields (raw firestoreDoc): " + JSON.stringify(firestoreDoc, null, 2));

      if (!firestoreDoc || !firestoreDoc.fields) {
          Logger.log("WARNING: firestoreDoc or firestoreDoc.fields is null/undefined/empty. Returning empty object.");
          Logger.log("--- DEBUG_UNWRAP_FIELDS_END ---");
          return {};
      }

      const obj = {};
      // Logger.log("Iterating through firestoreDoc.fields:");

      for (const key in firestoreDoc.fields) {
          const valueWrapper = firestoreDoc.fields[key];
          // Logger.log(`  Processing key: '${key}'`);
          
          // --- 优化：针对 embedding 字段的日志输出 ---
          if (key === 'embedding' && valueWrapper.arrayValue !== undefined) {
              const arrayLength = valueWrapper.arrayValue.values ? valueWrapper.arrayValue.values.length : 0;
              // Logger.log(`    Value wrapper for 'embedding': (array of ${arrayLength} doubleValues, full log suppressed)`);
          } else {
              // 其他字段正常打印 valueWrapper
              // Logger.log(`    Value wrapper for '${key}': ${JSON.stringify(valueWrapper)}`);
          }
          // --- 优化结束 ---

          const unwrappedValue = FirestoreService._unwrapSingleValue(valueWrapper);
          obj[key] = unwrappedValue;
      }

      // 处理文档元数据
      if (firestoreDoc.name) {
          obj.id = firestoreDoc.name.split('/').pop();
          // Logger.log(`  Metadata: Extracted id: '${obj.id}'`);
      }
      if (firestoreDoc.createTime) {
          obj.createTime = new Date(firestoreDoc.createTime);
          // Logger.log(`  Metadata: Extracted createTime: '${obj.createTime.toISOString()}'`);
      }
      if (firestoreDoc.updateTime) {
          obj.updateTime = new Date(firestoreDoc.updateTime);
          // Logger.log(`  Metadata: Extracted updateTime: '${obj.updateTime.toISOString()}'`);
      }

      // 注意: Final unwrapped object for document 的完整 JSON 可能会非常大，酌情注释掉
      // Logger.log("Final unwrapped object for document:");
      // Logger.log(JSON.stringify(obj, null, 2));
      // Logger.log("--- DEBUG_UNWRAP_FIELDS_END ---");
      return obj;
  },

  /**
   * 调试版本 _unwrapSingleValue: (包含详细日志，并优化大数组日志输出)
   */
  _unwrapSingleValue: function(valueWrapper) {
      // Logger.log("  --- DEBUG_UNWRAP_SINGLE_VALUE_START ---");
      // 注意: Input to _unwrapSingleValue 的完整 JSON 可能会非常大，酌情注释掉
      // Logger.log(`  Input to _unwrapSingleValue: ${JSON.stringify(valueWrapper)}`);

      if (valueWrapper === undefined || valueWrapper === null) {
          Logger.log("  Value wrapper is undefined or null. Returning null.");
          Logger.log("  --- DEBUG_UNWRAP_SINGLE_VALUE_END ---");
          return null;
      }

      let result;

      if (valueWrapper.stringValue !== undefined) {
          result = valueWrapper.stringValue;
          // Logger.log(`  Detected type: stringValue. Value: '${result}'`);
      } else if (valueWrapper.booleanValue !== undefined) {
          result = valueWrapper.booleanValue;
          // Logger.log(`  Detected type: booleanValue. Value: ${result}`);
      } else if (valueWrapper.integerValue !== undefined) {
          result = parseInt(valueWrapper.integerValue, 10);
          // Logger.log(`  Detected type: integerValue. Value: ${result}`);
      } else if (valueWrapper.doubleValue !== undefined) {
          result = parseFloat(valueWrapper.doubleValue);
          // Logger.log(`  Detected type: doubleValue. Value: ${result}`);
      } else if (valueWrapper.timestampValue !== undefined) {
          result = new Date(valueWrapper.timestampValue);
          // Logger.log(`  Detected type: timestampValue. Value: '${result.toISOString()}'`);
      } else if (valueWrapper.nullValue !== undefined) {
          result = null;
          // Logger.log(`  Detected type: nullValue. Value: null`);
      } else if (valueWrapper.arrayValue !== undefined) {
          // Logger.log("  Detected type: arrayValue. Recursively unwrapping array elements.");
          result = valueWrapper.arrayValue.values ?
              valueWrapper.arrayValue.values.map(v => FirestoreService._unwrapSingleValue(v)) : [];
          
          // --- 优化：截断大数组的日志输出 ---
          const maxArrayLogLength = 10; // 只显示数组的前10个元素
          const logResult = result.length > maxArrayLogLength 
                            ? JSON.stringify(result.slice(0, maxArrayLogLength)) + `... (total ${result.length} elements)`
                            : JSON.stringify(result);
          // Logger.log(`  Unwrapped array result: ${logResult}`);
          // --- 优化结束 ---

      } else if (valueWrapper.mapValue !== undefined) {
          // Logger.log("  Detected type: mapValue. Recursively unwrapping map.");
          result = FirestoreService._unwrapFields(valueWrapper.mapValue);
          // 注意: 嵌套的 mapValue 可能会再次产生大量日志，这里不进行额外截断，让 _unwrapFields 自己处理
          // Logger.log(`  Unwrapped map result: ${JSON.stringify(result)}`);
      } else if (valueWrapper.geoPointValue !== undefined) {
          result = {
              latitude: valueWrapper.geoPointValue.latitude,
              longitude: valueWrapper.geoPointValue.longitude
          };
          // Logger.log(`  Detected type: geoPointValue. Value: ${JSON.stringify(result)}`);
      } else if (valueWrapper.referenceValue !== undefined) {
          result = valueWrapper.referenceValue;
          // Logger.log(`  Detected type: referenceValue. Value: '${result}'`);
      } else {
          // Logger.log(`  WARNING: _unwrapSingleValue encountered unknown or unhandled Firestore value type. Raw wrapper: ${JSON.stringify(valueWrapper)}`);
          result = undefined;
      }

      // 注意: Result from _unwrapSingleValue 的完整 JSON 可能会非常大，酌情注释掉
      // Logger.log(`  Result from _unwrapSingleValue: ${JSON.stringify(result)}`);
      // Logger.log("  --- DEBUG_UNWRAP_SINGLE_VALUE_END ---");
      return result;
  },
  
  /**
   * 查询一个集合的所有文档
   */
  queryCollection: function(collectionName) {
    if (!this.projectId) { this._getAuthToken(); }
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${collectionName}`;
    const response = this._request(url);
    if (response && Array.isArray(response.documents)) {
      return response.documents.map(doc => FirestoreService._unwrapFields(doc)).filter(Boolean);
    }
    return [];
  },

  /**
   * 获取单个文档
   */
  getDocument: function(path) {
    if (!this.projectId) { this._getAuthToken(); }
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    try {
      const response = this._request(url);
      return response ? FirestoreService._unwrapFields(response) : null;
    } catch (e) {
      if (e.message.includes("NOT_FOUND")) {
        Logger.log(`INFO: Document not found at path: ${path}`);
        return null;
      }
      Logger.log(`ERROR getting document at ${path}: ${e.message}`);
      throw e;
    }
  },

/**
 * 更新一个文档
 * @param {string} path - 文档的完整路径 (e.g., 'collectionName/documentId')
 * @param {object} data - 要更新的字段和值 (只包含要修改的字段)
 * @returns {object} 更新后的文档对象
 */
updateDocument: function(path, data) {
  if (!this.projectId) { this._getAuthToken(); }
  const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
  const payload = this._wrapFields(data); // data 包含了要更新的字段和值

  // --- 关键修改：为 PATCH 请求添加 updateMask ---
  const updateMask = Object.keys(data).map(key => ({ fieldPath: key }));
  const requestUrl = `${url}?updateMask.fieldPaths=${updateMask.map(mask => encodeURIComponent(mask.fieldPath)).join('&updateMask.fieldPaths=')}`;
  // ************************************************

  const response = this._request(requestUrl, 'PATCH', payload); // 使用包含 updateMask 的 URL
  return response ? FirestoreService._unwrapFields(response) : null;
},


  deleteDocument: function(path) {
    if (!this.projectId) { this._getAuthToken(); }
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    try {
      this._request(url, 'DELETE');
      Logger.log(`成功删除文档: ${path}`);
    } catch (e) {
      Logger.log(`删除文档失败 ${path}: ${e.message}`);
      throw e;
    }
  },

  /**
   * 批量删除集合中的所有文档
   */
  deleteCollection: function(collectionName) {
    // 独有的日志标记，用于确认正在运行此版本
    Logger.log(`[DELETE_COLLECTION_V2.0_START] Attempting to clear collection: ${collectionName}`);

    // 减小批次大小以应对 "Transaction too big" 错误
    const batchSize = 50; // 从 200 减小到 50，如果还不行可以尝试 20 或更小
    let deletedCount = 0;

    if (!this.projectId) { this._getAuthToken(); }

    while (true) {
      const queryUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents:runQuery`;
      const queryPayload = {
        structuredQuery: {
          from: [{ collectionId: collectionName }],
          select: {
            fields: [
              { fieldPath: '__name__' }
            ]
          },
          limit: batchSize
        }
      };
      
      let queryResponse;
      try {
        queryResponse = this._request(queryUrl, 'POST', queryPayload);
      } catch (e) {
        Logger.log(`ERROR querying documents for deletion in ${collectionName}: ${e.message}`);
        throw e;
      }

      const documentsToDelete = queryResponse
        .filter(item => item.document)
        .map(item => item.document.name);

      if (documentsToDelete.length === 0) {
        break; 
      }

      const writes = documentsToDelete.map(docName => ({
        delete: docName
      }));

      const commitUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents:commit`;
      try {
        this._request(commitUrl, 'POST', { writes: writes });
      } catch (e) {
        Logger.log(`ERROR committing batch delete in ${collectionName}: ${e.message}`);
        throw e;
      }
      
      deletedCount += documentsToDelete.length;
      Logger.log(`  -> 已删除 ${deletedCount} 个文档。`);

      Utilities.sleep(1000); 
    }
    Logger.log(`[DELETE_COLLECTION_V2.0_END] Collection '${collectionName}' cleared. Total deleted: ${deletedCount} documents.`);
  },

  /**
   * 批量创建/更新文档 (Upsert)
   */
  batchUpsert: function(collectionName, objects, idField) {
    if (!objects || objects.length === 0) return 0;
    
    if (!this.projectId) {
        this._getAuthToken();
    }

    const writes = objects.map(obj => { 
        const docId = obj[idField];
        if (!docId) {
            Logger.log(`警告: 在批量写入到 ${collectionName} 时，有对象缺少 ID 字段 '${idField}'。`);
            return null;
        }
        
        const path = `${collectionName}/${docId}`;
        const dataToWrite = { ...obj };
        if (dataToWrite.hasOwnProperty(idField)) {
            delete dataToWrite[idField];
        }
        
        return {
            update: {
                name: `projects/${this.projectId}/databases/(default)/documents/${path}`,
                fields: FirestoreService._wrapFields(dataToWrite).fields 
            },
            updateMask: {
                fieldPaths: Object.keys(dataToWrite)
            }
        };
    }).filter(Boolean);

    if (writes.length === 0) return 0;
    
    const commitUrl = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents:commit`;
    this._request(commitUrl, 'POST', { writes: writes });
    
    return writes.length;
  }
};





// 文件名: backend/utils.gs (或任何其他 .gs 文件)

/**
 * [FINAL UNIT TEST]
 * 最终单元测试，用于验证手动JWT认证的 FirestoreService。
 * 
 * 运行此函数前，请确保：
 * 1. Firestore 数据库中存在名为 'technology_registry' 的集合且包含数据。
 * 2. 项目属性中的 Firestore 凭据 (FIRESTORE_*) 配置正确。
 */
function test_ManualJwtFirestoreService() {
  Logger.log("========== [开始] 手动JWT认证 FirestoreService 单元测试 ==========");
  
  const TEST_COLLECTION_NAME = 'technology_registry';
  
  try {
    // 步骤 1: 验证 FirestoreService 对象和函数是否存在
    if (typeof FirestoreService !== 'object' || FirestoreService === null) {
      throw new Error("测试失败：全局变量 'FirestoreService' 不存在或不是一个对象。");
    }
    Logger.log("✅ 步骤 1/4: FirestoreService 对象存在。");
    
    if (typeof FirestoreService.queryCollection !== 'function') {
      throw new Error("测试失败：'FirestoreService.queryCollection' 不是一个函数。");
    }
    Logger.log("✅ 步骤 2/4: FirestoreService.queryCollection 函数存在。");

    // 步骤 2: 调用函数并捕获返回结果
    Logger.log(`步骤 3/4: 正在调用 FirestoreService.queryCollection('${TEST_COLLECTION_NAME}')...`);
    const results = FirestoreService.queryCollection(TEST_COLLECTION_NAME);
    Logger.log("  -> 调用完成，没有抛出错误。");

    // 步骤 3: 验证返回结果的类型和内容
    Logger.log("步骤 4/4: 正在验证返回结果...");
    if (!Array.isArray(results)) {
      throw new Error(`测试失败：返回结果不是一个数组 (Array)，而是 ${typeof results}。`);
    }
    Logger.log(`  -> 成功获取到 ${results.length} 条记录。`);

    if (results.length > 0) {
      const firstRecord = results[0];
      Logger.log("  -> 第一条记录内容示例: " + JSON.stringify(firstRecord));
      
      if (typeof firstRecord === 'object' && firstRecord !== null && firstRecord.hasOwnProperty('tech_name')) {
        Logger.log("  -> ✅ 验证通过：记录是对象格式，并包含 'tech_name' 字段。");
      } else {
        throw new Error("测试失败：返回的记录不是有效的对象或缺少关键字段。");
      }
    } else {
      Logger.log("  -> 警告：返回了空数组。请确认 Firestore 中的 'technology_registry' 集合不为空，且 IAM 权限正确。");
    }

    Logger.log("🎉🎉🎉 [成功] 手动JWT认证 FirestoreService 单元测试通过！🎉🎉🎉");

  } catch (e) {
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    Logger.log(`!!!!!!!!!! [失败] 手动JWT认证 FirestoreService 单元测试失败 !!!!!!!!!`);
    Logger.log("错误信息: " + e.message);
    Logger.log("错误堆栈: " + e.stack);
    Logger.log("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
  } finally {
    Logger.log("========== [结束] 手动JWT认证 FirestoreService 单元测试 ==========");
  }
}

function clearAcademicPapersCollection() {
  const collectionName = CONFIG.FIRESTORE_COLLECTIONS.RAW_ACADEMIC_PAPERS; // 获取 RAW_ACADEMIC_PAPERS 集合的实际名称
  Logger.log(`准备清空集合: ${collectionName}`);
  try {
    FirestoreService.deleteCollection(collectionName);
    Logger.log(`集合 ${collectionName} 清空完成。`);
  } catch (e) {
    Logger.log(`清空集合 ${collectionName} 失败: ${e.message}`);
  }
}

/**
 * 这是一个测试函数，用于清空所有原始数据集合。
 * !! 警告 !!：运行此函数将永久删除数据。请谨慎操作。
 */
function clearAllRawDataCollections() {
  const rawDataCollections = [
    CONFIG.FIRESTORE_COLLECTIONS.RAW_ACADEMIC_PAPERS,
    CONFIG.FIRESTORE_COLLECTIONS.RAW_PATENT_DATA,
    CONFIG.FIRESTORE_COLLECTIONS.RAW_OPENSOURCE_DATA,
    CONFIG.FIRESTORE_COLLECTIONS.RAW_TECH_NEWS,
    CONFIG.FIRESTORE_COLLECTIONS.RAW_INDUSTRY_DYNAMICS,
    CONFIG.FIRESTORE_COLLECTIONS.RAW_COMPETITOR_INTELLIGENCE
  ];

  for (const colName of rawDataCollections) {
    Logger.log(`尝试清空集合: ${colName}`);
    try {
      FirestoreService.deleteCollection(colName);
      Logger.log(`集合 ${colName} 清空完成。`);
    } catch (e) {
      Logger.log(`清空集合 ${colName} 失败: ${e.message}`);
    }
  }
  Logger.log("所有原始数据集合清空尝试完成。");
}