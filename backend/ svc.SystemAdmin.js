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
   * ✅ [Final Corrected Version] 获取用于绘制数据流桑基图的数据。
   * 该函数现在采用严格的瀑布流模型，确保数据在每个阶段逻辑正确地递减。
   * @returns {object} 包含 nodes 和 links 数组，用于 ECharts 桑基图。
   */
  /**
   * ✅ [Final Corrected Version 3.0] 获取用于绘制数据流桑基图的数据。
   * 通过创建虚拟的“过滤汇总”节点，实现最终阶段视觉上的颜色分割。
   * @returns {object} 包含 nodes 和 links 数组，用于 ECharts 桑基图。
   */
  getSankeyData: function() {
    Logger.log("--- SystemAdminService.getSankeyData() [Strict Waterfall Logic] 开始执行 ---");
    try {
      // --- 1. 数据获取 ---
      const rawStats = RawDataStatsService.getStats() || { total: 0 };
      const allInsights = DataService.getDataAsObjects('TECH_INSIGHTS_MASTER') || [];

      // --- 2. 阶段数据计算 ---
      const rawTotal = rawStats.total || 0;
      const totalSignalsIdentified = allInsights.length;
      const passedToValidation = allInsights.filter(item => item && ['analyzing', 'completed', 'decision_completed', 'published'].includes(item.processing_status)).length;
      const passedToAnalysis = allInsights.filter(item => item && ['completed', 'decision_completed', 'published'].includes(item.processing_status)).length;
      const finalInsights = allInsights.filter(item => item && item.processing_status === 'published').length;

      // --- 3. 过滤数据计算 ---
      const filteredAtIngestion = Math.max(0, rawTotal - totalSignalsIdentified);
      const filteredAtSignal = Math.max(0, totalSignalsIdentified - passedToValidation);
      const filteredAtValidation = Math.max(0, passedToValidation - passedToAnalysis);
      const filteredAtAnalysis = Math.max(0, passedToAnalysis - finalInsights);
      const totalFiltered = filteredAtIngestion + filteredAtSignal + filteredAtValidation + filteredAtAnalysis;

      // --- 4. 节点定义 ---
      const nodes = [
        { name: '数据采集', value: rawTotal, x: 0, y: 50 },
        { name: '线索识别', value: totalSignalsIdentified, x: 25, y: 50 },
        { name: '证据验证', value: passedToValidation, x: 50, y: 50 },
        { name: '深度分析', value: passedToAnalysis, x: 75, y: 50 },
        { name: '洞察产出', value: finalInsights, x: 100, y: 30 },
        { name: '过滤归档', value: totalFiltered, x: 100, y: 70 }
      ];

      // ✅ 核心修改: 严格按照瀑布流模型生成连接
      const links = [];
      // 主流程
      if (totalSignalsIdentified > 0) links.push({ source: '数据采集', target: '线索识别', value: totalSignalsIdentified });
      if (passedToValidation > 0) links.push({ source: '线索识别', target: '证据验证', value: passedToValidation });
      if (passedToAnalysis > 0) links.push({ source: '证据验证', target: '深度分析', value: passedToAnalysis });
      if (finalInsights > 0) links.push({ source: '深度分析', target: '洞察产出', value: finalInsights });
      
      // 过滤流程，每个阶段都可能分流
      if (filteredAtIngestion > 0) links.push({ source: '数据采集', target: '过滤归档', value: filteredAtIngestion });
      if (filteredAtSignal > 0) links.push({ source: '线索识别', target: '过滤归档', value: filteredAtSignal });
      if (filteredAtValidation > 0) links.push({ source: '证据验证', target: '过滤归档', value: filteredAtValidation });
      if (filteredAtAnalysis > 0) links.push({ source: '深度分析', target: '过滤归档', value: filteredAtAnalysis });

      Logger.log("--- SystemAdminService.getSankeyData() [Strict Waterfall Logic] 执行完毕 ---");
      return { nodes: nodes, links: links.filter(l => l.value > 0) }; // 最终保险：只返回 value > 0 的连接

    } catch (e) {
      Logger.log(`CRITICAL ERROR in SystemAdminService.getSankeyData: ${e.message}\n${e.stack}`);
      return { error: `后端计算桑基图数据时发生错误: ${e.message}` };
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
