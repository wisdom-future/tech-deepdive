// 文件名: backend/svc.SystemAdmin.gs

/**
 * @file 系统管理服务：提供对核心配置数据的 CRUD 操作。
 */

const SystemAdminService = {

  /**
   * 获取指定注册表（集合）的所有条目。
   * @param {string} collectionKey - CONFIG.FIRESTORE_COLLECTIONS 中定义的集合键名。
   * @returns {Array<Object>} 注册表中的所有条目。
   */
  getRegistry: function(collectionKey) {
    try {
      return DataService.getDataAsObjects(collectionKey);
    } catch (e) {
      Logger.log(`SystemAdminService.getRegistry 失败 [${collectionKey}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`无法获取注册表 '${collectionKey}': ${e.message}`);
    }
  },

  /**
   * 向指定注册表（集合）添加新条目。
   * @param {string} collectionKey - CONFIG.FIRESTORE_COLLECTIONS 中定义的集合键名。
   * @param {Object} data - 要添加的条目数据。
   * @returns {Object} 添加成功后的条目数据。
   */
  addRegistryEntry: function(collectionKey, data) {
    try {
      // 确保有 ID 字段，如果没有则根据约定生成
      let idField;
      switch (collectionKey) {
        case 'TECH_REGISTRY': idField = 'tech_id'; break;
        case 'COMPETITOR_REGISTRY': idField = 'competitor_id'; break;
        case 'CONFERENCE_REGISTRY': idField = 'conference_id'; break;
        case 'REPORT_RECIPIENTS': idField = 'recipient_id'; break;
        case 'SCHEDULED_REPORTS_CONFIG': idField = 'job_id'; break;
        default: idField = 'id'; // 默认使用 'id'
      }

      if (!data[idField]) {
        // 如果前端没有提供 ID，后端可以生成一个
        data[idField] = Utilities.getUuid(); // Apps Script 内置的 UUID 生成器
      }
      data.id = data[idField]; // 确保 Firestore 的文档 ID 字段也存在

      // 添加创建时间等元数据
      data.created_timestamp = new Date();
      data.updated_timestamp = new Date();

      DataService.batchUpsert(collectionKey, [data], 'id'); // 使用 'id' 作为 Firestore 文档ID
      return { success: true, message: `成功添加条目到 ${collectionKey}。`, data: data };
    } catch (e) {
      Logger.log(`SystemAdminService.addRegistryEntry 失败 [${collectionKey}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`添加条目到 '${collectionKey}' 失败: ${e.message}`);
    }
  },

  /**
   * 更新指定注册表（集合）中的条目。
   * @param {string} collectionKey - CONFIG.FIRESTORE_COLLECTIONS 中定义的集合键名。
   * @param {string} itemId - 要更新的条目的 ID。
   * @param {Object} data - 要更新的字段和值。
   * @returns {Object} 更新成功后的条目数据。
   */
  updateRegistryEntry: function(collectionKey, itemId, data) {
    try {
      // 更新时间戳
      data.updated_timestamp = new Date();
      DataService.updateObject(collectionKey, itemId, data);
      return { success: true, message: `成功更新注册表 ${collectionKey} 中的条目 ${itemId}。`, data: data };
    } catch (e) {
      Logger.log(`SystemAdminService.updateRegistryEntry 失败 [${collectionKey}/${itemId}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`更新注册表 '${collectionKey}' 中的条目 '${itemId}' 失败: ${e.message}`);
    }
  },

  /**
   * 删除指定注册表（集合）中的条目。
   * @param {string} collectionKey - CONFIG.FIRESTORE_COLLECTIONS 中定义的集合键名。
   * @param {string} itemId - 要删除的条目的 ID。
   * @returns {Object} 删除结果。
   */
  deleteRegistryEntry: function(collectionKey, itemId) {
    try {
      // 这需要 DataService.deleteObject 方法，该方法需要调用 FirestoreService.deleteDocument
      DataService.deleteObject(collectionKey, itemId);
      return { success: true, message: `成功删除注册表 ${collectionKey} 中的条目 ${itemId}。` };
    } catch (e) {
      Logger.log(`SystemAdminService.deleteRegistryEntry 失败 [${collectionKey}/${itemId}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`删除注册表 '${collectionKey}' 中的条目 '${itemId}' 失败: ${e.message}`);
    }
  },

  // ... 其他系统管理功能（获取系统设置、用户、监控数据等）
  // 这些函数可以根据需要在此文件中继续添加
};

// 确保 DataService 中有 deleteObject 方法
// 在 backend/svc.Data.gs 中添加：
/*
  deleteObject(collectionKey, documentId) {
    try {
      const collectionName = this._getCollectionName(collectionKey);
      const path = `${collectionName}/${documentId}`;
      FirestoreService.deleteDocument(path); // 假设 FirestoreService 有 deleteDocument 方法
    } catch (e) {
      Logger.log(`DataService.deleteObject 失败 [${collectionKey}/${documentId}]: ${e.message} \\n ${e.stack}`);
      throw new Error(`删除文档 '${documentId}' 失败: ${e.message}`);
    }
  }
*/

// 并且在 backend/FirestoreService.gs 中确保有 deleteDocument 方法：
/*
  deleteDocument: function(path) {
    if (!this.projectId) { this._getAuthToken(); }
    const url = `https://firestore.googleapis.com/v1/projects/${this.projectId}/databases/(default)/documents/${path}`;
    try {
      this._request(url, 'DELETE');
      Logger.log(`Successfully deleted document at path: ${path}`);
    } catch (e) {
      Logger.log(`ERROR deleting document at ${path}: ${e.message}`);
      throw e;
    }
  },
*/
