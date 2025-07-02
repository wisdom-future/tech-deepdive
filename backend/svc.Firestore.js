// 文件名: backend/svc.Firestore.gs @20250702

/**
 * @file Firestore 数据访问服务
 * 版本 3.1 - 修正 batchCreate 逻辑。
 */

const FirestoreService = {
  
  firestoreInstance: null,

  _getFirestoreInstance: function() {
    if (this.firestoreInstance) {
      return this.firestoreInstance;
    }
    
    const scriptProperties = PropertiesService.getScriptProperties();
    const email = scriptProperties.getProperty('FIRESTORE_CLIENT_EMAIL');
    let key = scriptProperties.getProperty('FIRESTORE_PRIVATE_KEY');
    const projectId = scriptProperties.getProperty('FIRESTORE_PROJECT_ID');

    if (!email || !key || !projectId) {
      throw new Error("Firestore 凭据未在项目属性中完全配置。");
    }

    key = key.replace(/\\n/g, '\n');

    const firestoreApp = new FirestoreApp(); 
    this.firestoreInstance = firestoreApp.getFirestore(email, key, projectId);
    return this.firestoreInstance;
  },

  getDocument: function(path) {
    const firestore = this._getFirestoreInstance();
    const fullPath = `${firestore.url}/${path}`;
    try {
      const response = firestore.request(fullPath, "get");
      return firestore.unwrap(response.fields);
    } catch (e) {
      if (e.message.includes("NOT_FOUND")) {
        Logger.log(`INFO: Document not found at path: ${path}`);
        return null;
      }
      throw e;
    }
  },

  createDocument: function(collectionName, data, documentId = null) {
    const firestore = this._getFirestoreInstance();
    const docId = documentId || firestore.autoId();
    const fullPath = `${firestore.url}/${collectionName}/${docId}`;
    const payload = firestore.create(data);
    const response = firestore.request(fullPath, "patch", payload); 
    return firestore.unwrap(response.fields);
  },

  updateDocument: function(path, data) {
    const firestore = this._getFirestoreInstance();
    const fullPath = `${firestore.url}/${path}`;
    const payload = firestore.create(data);
    const response = firestore.request(fullPath, "patch", payload);
    return firestore.unwrap(response.fields);
  },
  
  execute: function(query) {
    const firestore = this._getFirestoreInstance();
    return query.run();
  },

  query: function(collectionName) {
    const firestore = this._getFirestoreInstance();
    return new Query(firestore, collectionName);
  },

  /**
   * ✅ 核心改造：执行一个预先构建好的批量写入请求。
   * @param {Array<object>} writes - 符合 Firestore API v1 'writes' 格式的数组。
   */
  executeBatchWrites: function(writes) {
    if (!writes || writes.length === 0) return;
    const firestore = this._getFirestoreInstance();
    const payload = { "writes": writes };
    // 调用 :commit 端点来执行批量写入
    firestore.request(`${firestore.url}:commit`, "post", payload);
  }
};
