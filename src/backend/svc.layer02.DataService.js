/**
 * @file layer02.DataService.js
 * @description 核心数据服务层。
 * [v5.0] 最终净化版：继承经过验证的路径构建逻辑，并确保向FirestoreService传递databaseId。
 */

const DataService = {
  
  DATABASE_ID: 'deepdive-engine',

  _getCollectionName: function(collectionKey) {
    const collectionName = CONFIG.FIRESTORE_COLLECTIONS[collectionKey];
    if (!collectionName) throw new Error(`未在 CONFIG.FIRESTORE_COLLECTIONS 中找到键名: ${collectionKey}`);
    return collectionName;
  },
  
  getDataAsObjects: function(collectionKey, options = {}) {
    const collectionName = this._getCollectionName(collectionKey);
    return FirestoreService.queryNativeMode(collectionName, this.DATABASE_ID, options);
  },

  getDocument: function(collectionKey, documentId) {
    const collectionName = this._getCollectionName(collectionKey);
    const path = `${collectionName}/${documentId}`;
    return FirestoreService.getDocument(path, this.DATABASE_ID);
  },

  updateObject: function(collectionKey, documentId, data) {
    const collectionName = this._getCollectionName(collectionKey);
    const path = `${collectionName}/${documentId}`;
    FirestoreService.updateDocument(path, data, this.DATABASE_ID);
  },

  deleteObject: function(collectionKey, documentId) {
    const collectionName = this._getCollectionName(collectionKey);
    const path = `${collectionName}/${documentId}`;
    FirestoreService.deleteDocument(path, this.DATABASE_ID);
  },

  /**
   * [WRITE] 安全的批量“创建或合并更新”(Upsert-Merge)。
   * 继承自您提供的、经过验证的、在DataService层构建完整路径的逻辑。
   */
  batchUpsert: function(collectionKey, objects, idField) {
    if (!objects || !Array.isArray(objects) || objects.length === 0) return 0;
    
    const collectionName = this._getCollectionName(collectionKey);
    if (!FirestoreService.projectId) FirestoreService._getAuthToken(); 

    const writes = objects.map(obj => {
      const docId = obj[idField];
      if (!docId) return null;
      
      const fieldsToUpdate = { ...obj };
      const updateMask = { fieldPaths: Object.keys(fieldsToUpdate) };

      return {
        update: {
          name: `projects/${FirestoreService.projectId}/databases/${this.DATABASE_ID}/documents/${collectionName}/${docId}`,
          fields: _fsWrapProperties(fieldsToUpdate)
        },
        updateMask: updateMask
      };
    }).filter(Boolean);

    if (writes.length > 0) {
      // 分块逻辑
      const CHUNK_SIZE = 499;
      for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
        const chunk = writes.slice(i, i + CHUNK_SIZE);
        FirestoreService.batchWrite(chunk, this.DATABASE_ID);
      }
    }
    return writes.length;
  },
  
  /**
   * [WRITE] 批量删除指定集合中的多个文档。
   * 继承自您提供的、在DataService层构建完整路径的逻辑。
   */
  batchDeleteDocs: function(collectionKey, documentIds) {
    if (!documentIds || !Array.isArray(documentIds) || documentIds.length === 0) return 0;

    const collectionName = this._getCollectionName(collectionKey);
    if (!FirestoreService.projectId) FirestoreService._getAuthToken();

    const writes = documentIds.map(docId => {
      if (!docId) return null;
      return {
        delete: `projects/${FirestoreService.projectId}/databases/${this.DATABASE_ID}/documents/${collectionName}/${docId}`
      };
    }).filter(Boolean);

    if (writes.length > 0) {
      const CHUNK_SIZE = 499;
      for (let i = 0; i < writes.length; i += CHUNK_SIZE) {
        const chunk = writes.slice(i, i + CHUNK_SIZE);
        FirestoreService.batchWrite(chunk, this.DATABASE_ID);
      }
    }
    return writes.length;
  }
};
