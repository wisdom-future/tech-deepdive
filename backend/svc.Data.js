// 文件名: backend/svc.Data.gs (最终修正版 - 延迟加载配置)

/**
 * @file 数据访问层服务，作为适配器，将上层服务的调用路由到 FirestoreService。
 * @version 8.0 - 采用延迟加载方式访问 CONFIG，彻底解决并行初始化问题。
 */
const DataService = {

  /**
   * ✅ 核心修正：将对 CONFIG 的访问移入函数内部。
   * 这样可以确保当此函数被调用时，Config.gs 文件一定已经被加载和解析完毕。
   */
  _getCollectionName: function(collectionKey) {
    if (!CONFIG || !CONFIG.FIRESTORE_COLLECTIONS) {
        throw new Error("全局配置对象 CONFIG 或 CONFIG.FIRESTORE_COLLECTIONS 未定义。请检查 Config.gs 文件。");
    }
    const collectionName = CONFIG.FIRESTORE_COLLECTIONS[collectionKey];
    if (!collectionName) {
      throw new Error(`在 CONFIG.FIRESTORE_COLLECTIONS 中未找到集合键 '${collectionKey}'。`);
    }
    return collectionName;
  },

  getDataAsObjects(collectionKey) {
    try {
      const collectionName = this._getCollectionName(collectionKey);
      return FirestoreService.queryCollection(collectionName);
    } catch (e) {
      Logger.log(`DataService.getDataAsObjects 失败 [${collectionKey}]: ${e.message} \n ${e.stack}`);
      throw new Error(`无法访问集合 '${collectionKey}': ${e.message}`);
    }
  },

  getLatestDataAsObjects(collectionKey, dataRowsToFetch = 100, timestampField = 'created_timestamp') {
     try {
      const collectionName = this._getCollectionName(collectionKey);
      const orderBy = { field: timestampField, direction: 'DESCENDING' };
      // ✅ 使用我们增强过的、支持所有参数的 queryCollection
      return FirestoreService.queryCollection(collectionName, [], orderBy, dataRowsToFetch);
    } catch (e) {
      Logger.log(`DataService.getLatestDataAsObjects 失败 [${collectionKey}]: ${e.message} \n ${e.stack}`);
      throw new Error(`无法从 '${collectionKey}' 获取最新数据: ${e.message}`);
    }
  },

  batchUpsert(collectionKey, objects, idField) {
    try {
      const collectionName = this._getCollectionName(collectionKey);
      // ✅ 调用 FirestoreService 中更健壮的 batchUpsert
      return FirestoreService.batchUpsert(collectionName, objects, idField);
    } catch (e) {
      Logger.log(`DataService.batchUpsert 失败 [${collectionKey}]: ${e.message} \n ${e.stack}`);
      throw new Error(`批量写入到 '${collectionKey}' 失败: ${e.message}`);
    }
  },
  
  updateObject(collectionKey, documentId, data) {
    try {
      const collectionName = this._getCollectionName(collectionKey);
      const path = `${collectionName}/${documentId}`;
      FirestoreService.updateDocument(path, data);
    } catch (e) {
      Logger.log(`DataService.updateObject 失败 [${collectionKey}/${documentId}]: ${e.message} \n ${e.stack}`);
      throw new Error(`更新文档 '${documentId}' 失败: ${e.message}`);
    }
  },

  // 在 backend/svc.Data.gs 中添加此方法
  deleteObject(collectionKey, documentId) {
    try {
      const collectionName = this._getCollectionName(collectionKey);
      const path = `${collectionName}/${documentId}`;
      FirestoreService.deleteDocument(path); // 调用 FirestoreService 的删除方法
    } catch (e) {
      Logger.log(`DataService.deleteObject 失败 [${collectionKey}/${documentId}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`删除文档 '${documentId}' 失败: ${e.message}`);
    }
  }
};
