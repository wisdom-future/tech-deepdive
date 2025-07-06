// 文件名: backend/svc.FirestoreService.gs

/**
 * @file Firestore 数据访问服务 (手动JWT认证模式)
 * @version 7.0 - 实现了对 queryCollection 的分页处理
 */
const FirestoreService = {
  REGION_ID: 'northamerica-northeast2',

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
      // Logger.log("使用缓存的Firestore访问令牌。"); // 在生产中可以注释掉以减少日志
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
   * 将普通的 JavaScript 对象，包装成 Firestore API 需要的格式。
   */
  _wrapFields: function(obj) {
      const fields = {};
      for (const key in obj) {
          if (obj.hasOwnProperty(key)) {
              const value = obj[key];
              if (value === null || value === undefined) {
                  fields[key] = { nullValue: null };
              } else if (typeof value === 'string') {
                  fields[key] = { stringValue: value };
              } else if (typeof value === 'boolean') {
                  fields[key] = { booleanValue: value };
              } else if (typeof value === 'number') {
                  if (Number.isInteger(value)) {
                      fields[key] = { integerValue: String(value) };
                  } else {
                      fields[key] = { doubleValue: value };
                  }
              } else if (value instanceof Date) {
                  fields[key] = { timestampValue: value.toISOString() };
              } else if (Array.isArray(value)) {
                  fields[key] = { 
                      arrayValue: { 
                          values: value.map(v => this._wrapFields({ temp: v }).fields.temp) 
                      } 
                  };
              } else if (typeof value === 'object') {
                  fields[key] = { mapValue: this._wrapFields(value) };
              } else {
                  fields[key] = { stringValue: String(value) };
              }
          }
      }
      return { fields };
  },

  /**
   * 将 Firestore 文档对象解包成普通的 JavaScript 对象。
   */
  _unwrapFields: function(firestoreDoc) {
    if (!firestoreDoc || !firestoreDoc.fields) {
      return {};
    }
    const obj = {};
    for (const key in firestoreDoc.fields) {
      obj[key] = this._unwrapSingleValue(firestoreDoc.fields[key]);
    }
    if (firestoreDoc.name) {
      obj.id = firestoreDoc.name.split('/').pop();
    }
    if (firestoreDoc.createTime) {
      obj.createTime = new Date(firestoreDoc.createTime);
    }
    if (firestoreDoc.updateTime) {
      obj.updateTime = new Date(firestoreDoc.updateTime);
    }
    return obj;
  },

  /**
   * 将 Firestore 单个字段的值包装器解包成 JavaScript 的原始值。
   */
  _unwrapSingleValue: function(valueWrapper) {
    if (!valueWrapper) {
      return null;
    }
    const valueType = Object.keys(valueWrapper)[0];
    const rawValue = valueWrapper[valueType];
    switch (valueType) {
      case 'stringValue': return rawValue;
      case 'booleanValue': return rawValue;
      case 'integerValue': return parseInt(rawValue, 10);
      case 'doubleValue': return parseFloat(rawValue);
      case 'timestampValue': return new Date(rawValue);
      case 'nullValue': return null;
      case 'arrayValue': return (rawValue && Array.isArray(rawValue.values)) ? rawValue.values.map(v => this._unwrapSingleValue(v)) : [];
      case 'mapValue': return this._unwrapFields(rawValue);
      case 'geoPointValue': return { latitude: rawValue.latitude, longitude: rawValue.longitude };
      case 'referenceValue': return rawValue;
      default: return undefined;
    }
  },
  
  /**
   * ✅ 终极修正版: 查询一个集合的所有文档，并自动处理分页。
   * @param {string} collectionName - 要查询的集合的名称。
   * @param {number} [pageSize=300] - 每次分页请求获取的文档数量。Firestore最大支持300。
   * @returns {Array<Object>} - 包含所有已解析文档的数组。
   */
  queryCollection: function(collectionName, pageSize = 300) {
    if (!this.projectId) this._getAuthToken();
    
    let allDocuments = [];
    let nextPageToken = null;
    
    Logger.log(`[FirestoreService] 开始分页查询集合 '${collectionName}'...`);

    do {
      // 构建带分页参数的URL
      let url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${collectionName}?pageSize=${pageSize}`;
      if (nextPageToken) {
        url += `&pageToken=${nextPageToken}`;
      }
      
      Logger.log(`  -> 正在请求分页: ${nextPageToken ? `(Token: ...${nextPageToken.slice(-6)})` : '(第一页)'}`);
      const response = this._request(url, 'GET');
      
      if (response && Array.isArray(response.documents)) {
        const documents = response.documents.map(doc => this._unwrapFields(doc));
        allDocuments = allDocuments.concat(documents);
        Logger.log(`  -> 本页获取到 ${documents.length} 条记录，当前总计: ${allDocuments.length}`);
      }
      
      // 获取下一页的令牌
      nextPageToken = response.nextPageToken || null;

    } while (nextPageToken); // 如果还有下一页，就继续循环

    Logger.log(`[FirestoreService] 集合 '${collectionName}' 查询完毕，共获取到 ${allDocuments.length} 条记录。`);
    return allDocuments;
  },

  getDocument: function(path) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    try {
      const response = this._request(url);
      return response ? this._unwrapFields(response) : null;
    } catch (e) {
      if (e.message.includes("NOT_FOUND")) {
        Logger.log(`INFO: Document not found at path: ${path}`);
        return null;
      }
      Logger.log(`ERROR getting document at ${path}: ${e.message}`);
      throw e;
    }
  },

  updateDocument: function(path, data) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    const payload = this._wrapFields(data);
    const updateMask = Object.keys(data).map(key => (`updateMask.fieldPaths=${encodeURIComponent(key)}`));
    const requestUrl = `${url}?${updateMask.join('&')}`;
    const response = this._request(requestUrl, 'PATCH', payload);
    return response ? this._unwrapFields(response) : null;
  },

  deleteDocument: function(path) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    try {
      this._request(url, 'DELETE');
      Logger.log(`成功删除文档: ${path}`);
    } catch (e) {
      Logger.log(`删除文档失败 ${path}: ${e.message}`);
      throw e;
    }
  },

  batchUpsert: function(collectionName, objects, idField) {
    if (!objects || objects.length === 0) return 0;
    if (!this.projectId) this._getAuthToken();
    const writes = objects.map(obj => { 
        const docId = obj[idField];
        if (!docId) {
            Logger.log(`警告: 在批量写入到 ${collectionName} 时，有对象缺少 ID 字段 '${idField}'。`);
            return null;
        }
        const path = `projects/${this.projectId}/databases/(default)/documents/${collectionName}/${docId}`;
        const dataToWrite = { ...obj };
        delete dataToWrite[idField];
        return { 
            update: { 
                name: path, 
                fields: this._wrapFields(dataToWrite).fields 
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
