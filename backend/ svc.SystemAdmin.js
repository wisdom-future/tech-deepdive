// 文件名: backend/svc.SystemAdmin.gs

/**
 * @file 系统管理服务：提供对核心配置数据的 CRUD 操作。
 */

const SystemAdminService = {

  /**
   * 获取指定注册表的所有数据。
   * @param {string} registryKey - 在 CONFIG 中定义的注册表键名 (e.g., 'TECH_REGISTRY').
   * @returns {Array<Object>} 注册表中的所有对象。
   */
  getRegistry: function(registryKey) {
    Logger.log(`SystemAdminService: 正在为注册表 '${registryKey}' 获取数据`);
    try {
      // DataService 会处理键名到集合名的转换
      return DataService.getDataAsObjects(registryKey);
    } catch (e) {
      Logger.log(`获取注册表 '${registryKey}' 时出错: ${e.message}`);
      throw new Error(`获取注册表 '${registryKey}' 数据失败: ${e.message}`);
    }
  },

  /**
   * 在指定的注册表中添加一个新条目。
   * @param {string} registryKey - 注册表键名。
   * @param {Object} entryData - 要添加的新条目的数据对象。
   * @returns {Object} 确认消息。
   */
  addRegistryEntry: function(registryKey, entryData) {
    try {
      // 定义每个注册表类型的主键字段
      const idFieldMapping = {
        'REPORT_RECIPIENTS': 'recipient_id',
        'TECH_REGISTRY': 'tech_id',
        'COMPETITOR_REGISTRY': 'competitor_id',
        'CONFERENCE_REGISTRY': 'conference_id'
      };
      
      const idField = idFieldMapping[registryKey];
      if (!idField) {
        throw new Error(`未找到注册表的主键映射: ${registryKey}`);
      }

      // 如果条目没有 ID，则生成一个新的唯一 ID。
      if (!entryData[idField]) {
        // 示例 ID 生成方式，可以根据您的需求调整
        entryData[idField] = `REC_${new Date().getTime()}`; 
      }
      
      // 添加创建和更新时间戳，这是良好的实践
      const now = new Date();
      entryData.created_timestamp = now;
      entryData.updated_timestamp = now;

      // --- 这是修复之处 ---

      // 错误的代码 (您的现有代码可能类似于此):
      // FirestoreService.createDocument('some/path', entryData); // 此函数不存在。

      // 正确的代码 (使用 DataService 封装的 batchUpsert):
      // 我们将单个 entryData 对象封装在一个数组中，因为 batchUpsert 期望一个数组。
      const resultCount = DataService.batchUpsert(registryKey, [entryData], idField);

      if (resultCount > 0) {
        Logger.log(`成功在 '${registryKey}' 中添加/更新了 ID 为 ${entryData[idField]} 的条目。`);
        return { success: true, message: "条目保存成功。", data: entryData };
      } else {
        // 理论上，如果未抛出错误，则不应达到此情况
        throw new Error("批量更新操作完成，但未写入任何文档。");
      }

    } catch (e) {
      Logger.log(`SystemAdminService.addRegistryEntry 在 '${registryKey}' 中发生错误: ${e.message}\n${e.stack}`);
      // 重新抛出错误，以便前端接收到正确的失败消息
      throw new Error(`向注册表 '${registryKey}' 添加条目失败: ${e.message}`);
    }
  },

  /**
   * 更新指定注册表中的一个现有条目。
   * @param {string} registryKey - 注册表键名。
   * @param {string} docId - 要更新的文档的ID。
   * @param {Object} updateData - 包含要更新的字段的对象。
   * @returns {Object} 确认消息。
   */
  updateRegistryEntry: function(registryKey, docId, updateData) {
    Logger.log(`SystemAdminService: 正在更新 '${registryKey}' 中的条目 '${docId}'`);
    try {
      const dataToUpdate = {
        ...updateData,
        updated_timestamp: new Date()
      };
      
      // 直接调用 DataService 的 updateObject 方法
      DataService.updateObject(registryKey, docId, dataToUpdate);

      Logger.log(`成功更新了 '${registryKey}' 中的条目 '${docId}'.`);
      return { success: true, id: docId };
    } catch (e) {
      Logger.log(`在 updateRegistryEntry ('${registryKey}') 中出错: ${e.message}\n${e.stack}`);
      throw new Error(`更新注册表 '${registryKey}' 中 ID 为 '${docId}' 的条目失败: ${e.message}`);
    }
  },

  /**
   * 从指定的注册表中删除一个条目。
   * @param {string} registryKey - 注册表键名。
   * @param {string} docId - 要删除的文档的ID。
   * @returns {Object} 确认消息。
   */
  deleteRegistryEntry: function(registryKey, docId) {
    Logger.log(`SystemAdminService: 正在从 '${registryKey}' 删除条目 '${docId}'`);
    try {
      // 你的 DataService 需要一个 deleteObject 方法
      DataService.deleteObject(registryKey, docId);
      
      Logger.log(`成功从注册表 '${registryKey}' 删除了条目 '${docId}'.`);
      return { success: true };
    } catch (e) {
      Logger.log(`在 deleteRegistryEntry ('${registryKey}') 中出错: ${e.message}\n${e.stack}`);
      throw new Error(`从注册表 '${registryKey}' 删除 ID 为 '${docId}' 的条目失败: ${e.message}`);
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
  }

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
