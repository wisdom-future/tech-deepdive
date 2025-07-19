/**
 * @file layer01.FirestoreService.js
 * @description [核心基础设施层] Firestore API 封装。
 * 负责所有与 Google Firestore REST API 的底层HTTP通信、认证和数据打包/解包。
 * 此服务不应包含任何业务逻辑，只提供纯粹的、原子化的数据库操作。
 */

// ================== 全局辅助函数 (用于打包和解包Firestore数据) ==================

function _fsWrapValue(value) {
  if (value === null || value === undefined) return { nullValue: null };
  if (typeof value === 'string') return { stringValue: value };
  if (typeof value === 'boolean') return { booleanValue: value };
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value };
  if (value instanceof Date) return { timestampValue: value.toISOString() };
  if (Array.isArray(value)) return { arrayValue: { values: value.map(v => _fsWrapValue(v)) } };
  if (typeof value === 'object') return { mapValue: { fields: _fsWrapProperties(value) } };
  return { stringValue: String(value) };
}

function _fsWrapProperties(obj) {
  const properties = {};
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      properties[key] = _fsWrapValue(obj[key]);
    }
  }
  return properties;
}

function _fsUnwrapSingleValue(valueWrapper) {
  if (!valueWrapper) return null;
  const valueType = Object.keys(valueWrapper)[0];
  if (!valueType) return null;
  const rawValue = valueWrapper[valueType];

  switch (valueType) {
    case 'stringValue':
    case 'booleanValue':
      return rawValue;
    case 'integerValue':
      return parseInt(rawValue, 10);
    case 'doubleValue':
      return parseFloat(rawValue);
    case 'timestampValue':
      return new Date(rawValue);
    case 'nullValue':
      return null;
    case 'arrayValue':
      return (rawValue.values || []).map(v => _fsUnwrapSingleValue(v));
    case 'mapValue':
      return _fsUnwrapProperties(rawValue);
    default:
      return rawValue;
  }
}

function _fsUnwrapProperties(firestoreMap) {
  const obj = {};
  const properties = firestoreMap.fields || firestoreMap.properties || {};
  for (const key in properties) {
    if (properties.hasOwnProperty(key)) {
      obj[key] = _fsUnwrapSingleValue(properties[key]);
    }
  }
  return obj;
}

function _fsUnwrapEntity(entity) {
  const obj = _fsUnwrapProperties(entity);
  if (entity && entity.key && entity.key.path && entity.key.path.length > 0) {
    const pathElement = entity.key.path[entity.key.path.length - 1];
    obj.id = pathElement.id || pathElement.name;
  }
  return obj;
}

function _fsUnwrapDocument(document) {
  const obj = _fsUnwrapProperties(document);
  if (document.name) {
    const docId = document.name.split('/').pop();
    obj.id = docId; // 保留 'id' 字段以兼容可能存在的旧逻辑
    if (obj.entity_id === undefined) { 
        obj.entity_id = docId;
    }
  }
  return obj;
}

// ================== FirestoreService 对象定义 ==================

const FirestoreService = {
  authToken: null,
  tokenExpiration: 0,
  projectId: null,

  _getAuthToken: function() {
    const now = Math.floor(Date.now() / 1000);
    if (this.authToken && this.tokenExpiration > now + 60) {
      return this.authToken;
    }

    const scriptProperties = PropertiesService.getScriptProperties();
    const clientEmail = scriptProperties.getProperty('FIRESTORE_CLIENT_EMAIL');
    const privateKey = scriptProperties.getProperty('FIRESTORE_PRIVATE_KEY');
    this.projectId = scriptProperties.getProperty('FIRESTORE_PROJECT_ID');
    if (!clientEmail || !privateKey || !this.projectId) {
      throw new Error("Firestore服务账号凭据未在脚本属性中完全配置。");
    }

    const jwtHeader = { alg: "RS256", typ: "JWT" };
    const claimSet = { iss: clientEmail, scope: "https://www.googleapis.com/auth/datastore", aud: "https://oauth2.googleapis.com/token", exp: now + 3600, iat: now };

    const toSign = Utilities.base64EncodeWebSafe(JSON.stringify(jwtHeader)) + "." + Utilities.base64EncodeWebSafe(JSON.stringify(claimSet));
    const signatureBytes = Utilities.computeRsaSha256Signature(toSign, privateKey.replace(/\\n/g, '\n'));
    const signature = Utilities.base64EncodeWebSafe(signatureBytes);
    const jwt = toSign + "." + signature;
    const tokenResponse = UrlFetchApp.fetch("https://oauth2.googleapis.com/token", { method: "post", contentType: "application/x-www-form-urlencoded", muteHttpExceptions: true, payload: { grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt } });
    const responseCode = tokenResponse.getResponseCode();
    const responseText = tokenResponse.getContentText();
    if (responseCode >= 300) {
      throw new Error(`获取令牌失败 (${responseCode}): ${responseText}`);
    }
    const tokenData = JSON.parse(responseText);
    this.authToken = tokenData.access_token;
    this.tokenExpiration = now + tokenData.expires_in;
    return this.authToken;
  },

  /**
   * [PUBLIC] 执行HTTP请求，由DataService调用。
   */
  _request: function(url, method = 'GET', payload = null) {
    const options = {
      method: method.toLowerCase(),
      headers: { "Authorization": "Bearer " + this._getAuthToken() },
      contentType: "application/json",
      muteHttpExceptions: true
    };
    if (payload) {
      options.payload = JSON.stringify(payload);
    }
    const response = UrlFetchApp.fetch(url, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    if (responseCode >= 300) {
      let errorMessage = `Firestore API Error (${responseCode}): ${responseText}`;
      try {
        const errorObj = JSON.parse(responseText);
        if (errorObj && errorObj.error && errorObj.error.message) {
          errorMessage = `Firestore API Error (${responseCode}): ${errorObj.error.message}`;
        }
      } catch (e) { /* Ignore */ }
      throw new Error(errorMessage);
    }

    if (!responseText) return {};
    try {
      return JSON.parse(responseText);
    } catch (e) {
      Logger.log(`[FirestoreService._request] WARNING: Successful response (Code ${responseCode}) was not valid JSON.`);
      return {};
    }
  },
  
  queryNativeMode: function(collectionName, databaseId, options = {}) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents:runQuery`;
    const body = { structuredQuery: { from: [{ collectionId: collectionName }] } };
    
    if (options.filters && options.filters.length > 0) {
      body.structuredQuery.where = { compositeFilter: { op: "AND", filters: options.filters.map(f => ({ fieldFilter: { field: { fieldPath: f.field }, op: f.operator.toUpperCase().replace('==', 'EQUAL'), value: _fsWrapValue(f.value) } })) } };
    }
    if (options.orderBy) {
      body.structuredQuery.orderBy = [{ field: { fieldPath: options.orderBy.field }, direction: options.orderBy.direction || 'ASCENDING' }];
    }
    if (options.limit) {
      body.structuredQuery.limit = options.limit;
    }

    const response = this._request(url, 'POST', body);

    if (Array.isArray(response)) {
      return response.filter(item => item.document).map(item => _fsUnwrapDocument(item.document));
    }
    return [];
  },
  
 /**
   * [PUBLIC] 使用PATCH方法安全地更新（合并）单个文档。
   * ✅ [核心修正] 严格使用传入的 databaseId 参数。
   */
  updateDocument: function(path, data, databaseId) {
    if (!this.projectId) this._getAuthToken();
    const updateMask = Object.keys(data).map(key => `updateMask.fieldPaths=${encodeURIComponent(key)}`).join('&');
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents/${path}?${updateMask}`;
    const payload = { fields: _fsWrapProperties(data) };
    return this._request(url, 'PATCH', payload);
  },

  /**
   * [PUBLIC] 获取单个文档的数据。
   * ✅ [核心修正] 严格使用传入的 databaseId 参数。
   */
  getDocument: function(path, databaseId) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents/${path}`;
    try {
      const response = this._request(url, 'GET');
      return response && response.fields ? _fsUnwrapDocument(response) : null;
    } catch (e) {
      if (e.message.includes("404")) {
        return null;
      }
      throw e;
    }
  },

  /**
   * ✅ [核心修正] 补回并修正 deleteDocument 方法。
   * [PUBLIC] 删除单个文档。
   * @param {string} path - 文档的相对路径 (e.g., 'collectionName/documentId')。
   * @param {string} databaseId - 目标数据库的ID。
   */
  deleteDocument: function(path, databaseId) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents/${path}`;
    return this._request(url, 'DELETE');
  },

  /**
   * [PUBLIC] 执行批量写入请求。
   * ✅ [核心修正] 严格使用传入的 databaseId 参数。
   */
  batchWrite: function(writes, databaseId) {
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents:batchWrite`;
    const payload = { writes: writes };
    return this._request(url, 'POST', payload);
  },

  patchDocument: function(path, fieldsObject, databaseId) { // ✅ 确保接收 databaseId
    if (!this.projectId) this._getAuthToken();
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/${databaseId}/documents/${path}`;
    const payload = { fields: _fsWrapProperties(fieldsObject) };
    return this._request(url, 'PATCH', payload);
  }
};
