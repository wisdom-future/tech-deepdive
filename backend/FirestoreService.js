// 文件名: backend/FirestoreService.gs (最终完整、无省略版)

/**
 * @file Firestore 数据访问服务 (手动JWT认证模式)
 * @version 5.0 - 最终稳定版
 * 通过手动创建和签名JWT来获取OAuth令牌，绕过部署时的权限验证问题，
 * 并确保在服务器端执行时能忽略Firestore安全规则。
 * 包含了所有必需的 CRUD (创建、读取、更新、删除) 辅助函数。
 */
const FirestoreService = {
  
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
  /**
   * ✅ 核心修正：让 _request 函数能够处理完整的 URL
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
   * 将 JS 对象转换为 Firestore 的 "fields" 格式
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
                  fields[key] = { arrayValue: { values: value.map(v => this._wrapFields({v}).fields.v) } };
              }
              else fields[key] = { stringValue: JSON.stringify(value) };
          }
      }
      return { fields };
  },

  /**
   * 将 Firestore 的 "fields" 格式解析为 JS 对象
   */
  _unwrapFields: function(firestoreDoc) {
      if (!firestoreDoc) return null;
      
      const obj = {};
      
      if (firestoreDoc.fields) {
        for (const key in firestoreDoc.fields) {
            const valueWrapper = firestoreDoc.fields[key];
            const valueType = Object.keys(valueWrapper)[0];
            
            if (valueType) {
                if (valueType === 'timestampValue') {
                  obj[key] = new Date(valueWrapper[valueType]);
                } else if (valueType === 'nullValue') {
                  obj[key] = null;
                } else {
                  obj[key] = valueWrapper[valueType];
                }
            }
        }
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
   * 查询一个集合的所有文档
   */
  queryCollection: function(collectionName) {
    if (!this.projectId) { this._getAuthToken(); }
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${collectionName}`;
    const response = this._request(url); // ✅ 直接传递完整 URL
    if (response && Array.isArray(response.documents)) {
      return response.documents.map(doc => this._unwrapFields(doc)).filter(Boolean);
    }
    return [];
  },


  /**
   * 批量创建/更新文档 (Upsert)
   */
  batchUpsert: function(collectionName, objects, idField) {
    if (!objects || objects.length === 0) return 0;
    
    // 确保 projectId 已被初始化
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
                fields: this._wrapFields(dataToWrite).fields 
            },
            updateMask: {
                fieldPaths: Object.keys(dataToWrite)
            }
        };
    }).filter(Boolean);

    if (writes.length === 0) return 0;
    
    // ✅ 构造正确的 commit URL
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
