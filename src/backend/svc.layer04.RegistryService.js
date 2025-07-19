/**
 * @file layer04.RegistryService.js
 * @description [API服务层] 统一管理所有“注册表”类数据 (实体, 数据源, 用户, 角色)。
 * 这是面向前端“系统管理”页面的主要API服务。
 * 
 * @version 2.0 (Corrected Signatures)
 * @changelog
 *  - [FIX] All public API methods now accept `authInfo` as the first parameter to align with the `callApi` gateway's invocation pattern.
 */

const RegistryService = {

  //==================================================================
  // SECTION 1: 系统概览快照
  //==================================================================

  /**
   * [API] 获取系统实体概览快照。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  getSystemSnapshot: function(authInfo) {
    try {
      const allEntities = DataService.getDataAsObjects('REG_ENTITIES') || [];
      const allUsers = DataService.getDataAsObjects('REG_USERS') || [];
      const allRoles = DataService.getDataAsObjects('REG_ROLES') || [];
      const allSources = DataService.getDataAsObjects('REG_SOURCES') || [];
      const allWorkflows = DataService.getDataAsObjects('LOG_WORKFLOWS') || []; // 假设有工作流日志
      const allReports = DataService.getDataAsObjects('LOG_REPORTS_HISTORY') || []; // 假设有报告历史

      const snapshot = {
        techCount: allEntities.filter(e => e.entity_type === 'Technology').length,
        companyCount: allEntities.filter(e => e.entity_type === 'Company').length,
        personCount: allEntities.filter(e => e.entity_type === 'Person').length,
        conferenceCount: allEntities.filter(e => e.entity_type === 'Business_Event').length, // 假设 Business_Event 包含会议
        dataSourceCount: allSources.length,
        userCount: allUsers.length,
        adminCount: allUsers.filter(u => u.role_id === 'admin').length, // 假设 admin 角色
        taskCount: DataService.getDataAsObjects('QUEUE_TASKS').length, // 任务队列长度
        templateCount: DataService.getDataAsObjects('REP_TEMPLATES').length || 0, // 假设有报告模板集合

        // 模拟 mock_api 中的细节字段
        latestTech: 'N/A', // 需要从最近更新的技术实体中获取
        highPriorityCompanies: allEntities.filter(e => e.entity_type === 'Company' && (e.relevance_score || 0) >= 80).length, // 假设高优先级公司
        upcomingConference: 'N/A', // 需要从 Business_Event 中获取最近的会议
        errorDataSources: allSources.filter(s => !s.is_active || s.status === 'error').length, // 假设数据源有状态字段
        failedTasks: allWorkflows.filter(w => w.execution_status === 'FAILED' && new Date(w.end_timestamp) > new Date(new Date().getTime() - 24 * 3600 * 1000)).length, // 过去24小时失败任务
        popularTemplate: 'N/A' // 需要从报告使用情况中统计
      };

      // 填充 latestTech 和 upcomingConference (需要进一步逻辑)
      const latestTechEntity = allEntities.filter(e => e.entity_type === 'Technology').sort((a,b) => new Date(b.updated_timestamp) - new Date(a.updated_timestamp))[0];
      if (latestTechEntity) snapshot.latestTech = latestTechEntity.primary_name;

      const upcomingEvent = allEntities.filter(e => e.entity_type === 'Business_Event' && e.event_date && new Date(e.event_date) > new Date()).sort((a,b) => new Date(a.event_date) - new Date(b.event_date))[0];
      if (upcomingEvent) snapshot.upcomingConference = upcomingEvent.primary_name;

      return snapshot;

    } catch(e) {
      Logger.log(`[RegistryService.getSystemSnapshot] ERROR: ${e.message}`);
      // 发生错误时返回一个结构完整的空对象
      return {
        techCount: 0, companyCount: 0, personCount: 0, conferenceCount: 0,
        dataSourceCount: 0, userCount: 0, adminCount: 0, taskCount: 0, templateCount: 0,
        latestTech: 'N/A', highPriorityCompanies: 0, upcomingConference: 'N/A',
        errorDataSources: 0, failedTasks: 0, popularTemplate: 'N/A'
      };
    }
  },

  //==================================================================
  // SECTION 2: 通用注册表管理
  //==================================================================

  /**
   * [API] 通用方法：获取指定注册表的数据列表。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  getRegistry: function(authInfo, registryKey, options = {}) {
    if (!CONFIG.FIRESTORE_COLLECTIONS[registryKey] || !registryKey.startsWith('REG_') && registryKey !== 'automation_tasks' && registryKey !== 'report_templates') {
      throw new Error(`无效或非法的注册表键名: ${registryKey}`);
    }
    const { page = 1, limit = 50, search = '' } = options;
    
    // 假设这些 registryKey 对应到实际的集合
    let collectionName = CONFIG.FIRESTORE_COLLECTIONS[registryKey] || registryKey; // 允许直接传递集合名

    let allRecords = DataService.getDataAsObjects(collectionName, { filters: options.filters || [] }) || [];

    // 内存搜索过滤
    if (search) {
        allRecords = allRecords.filter(item => {
            return Object.values(item).some(val => String(val).toLowerCase().includes(search.toLowerCase()));
        });
    }

    const totalRecords = allRecords.length;
    const startIndex = (page - 1) * limit;
    const paginatedRecords = allRecords.slice(startIndex, startIndex + limit);
    
    // 对特定注册表进行格式化以匹配 mock_api.js
    let formattedRecords = paginatedRecords;
    if (registryKey === 'technology_registry') { // 对应 REG_ENTITIES 中 entity_type = 'Technology'
        formattedRecords = paginatedRecords.map(e => ({
            id: e.entity_id,
            tech_name: e.primary_name,
            tech_keywords: (e.search_keywords || []).join(', ') || (e.tech_keywords || ''), // 兼容旧字段
            tech_category: e.category || 'N/A',
            monitoring_status: e.monitoring_status,
            created_date: DateUtils.formatDate(e.created_timestamp)
        }));
    } else if (registryKey === 'competitor_registry') { // 对应 REG_ENTITIES 中 entity_type = 'Company'
        formattedRecords = paginatedRecords.map(e => ({
            id: e.entity_id,
            company_name: e.primary_name,
            industry: e.category || 'N/A',
            priority: (e.relevance_score && e.relevance_score >= 80) ? '高' : ((e.relevance_score && e.relevance_score >= 50) ? '中' : '低'),
            focus_area: (e.search_keywords || []).slice(0,2).join(', ') || 'N/A',
            monitoring_status: e.monitoring_status
        }));
    } else if (registryKey === 'conference_registry') { // 对应 REG_ENTITIES 中 entity_type = 'Business_Event'
        formattedRecords = paginatedRecords.map(e => ({
            id: e.entity_id,
            name: e.primary_name,
            full_name: e.description || e.primary_name,
            focus: (e.key_themes || []).join(', ') || 'N/A',
            next_date: DateUtils.formatDate(e.event_date) || 'N/A' // 假设 Business_Event 有 event_date
        }));
    } else if (registryKey === 'external_data_sources') { // 对应 REG_SOURCES
        formattedRecords = paginatedRecords.map(e => ({
            id: e.source_id,
            name: e.display_name,
            type: (e.source_type || []).join(', '),
            url: e.base_url,
            status: e.is_active ? '启用' : '禁用'
        }));
    } else if (registryKey === 'user_accounts') { // 对应 REG_USERS
        formattedRecords = paginatedRecords.map(e => ({
            id: e.user_email,
            user_email: e.user_email,
            display_name: e.display_name,
            role_id: e.role_id,
            status: e.status
        }));
    } else if (registryKey === 'automation_tasks') { // 模拟
        formattedRecords = paginatedRecords.map(e => ({
            id: e.id,
            name: e.name,
            frequency: e.frequency,
            last_run: e.last_run,
            status: e.status
        }));
    } else if (registryKey === 'report_templates') { // 模拟
        formattedRecords = paginatedRecords.map(e => ({
            id: e.id,
            name: e.name,
            created_by: e.created_by,
            created_at: e.created_at
        }));
    }


    return { records: formattedRecords, totalRecords: totalRecords };
  },

  /**
   * [API] 通用方法：获取注册表中的单个条目。
   * 匹配 mock_api.js -> SystemAdminService.getRegistryItem
   */
  getRegistryItem: function(authInfo, registryKey, itemId) {
    let collectionName = CONFIG.FIRESTORE_COLLECTIONS[registryKey] || registryKey;
    const item = DataService.getDocument(collectionName, itemId);
    
    // 对特定注册表进行格式化以匹配 mock_api.js
    if (registryKey === 'technology_registry' && item) {
        return {
            id: item.entity_id,
            tech_name: item.primary_name,
            tech_keywords: (item.search_keywords || []).join(', ') || (item.tech_keywords || ''),
            tech_category: item.category || 'N/A',
            monitoring_status: item.monitoring_status,
            created_date: DateUtils.formatDate(item.created_timestamp)
        };
    } else if (registryKey === 'competitor_registry' && item) {
        return {
            id: item.entity_id,
            company_name: item.primary_name,
            industry: item.category || 'N/A',
            priority: (item.relevance_score && item.relevance_score >= 80) ? '高' : ((item.relevance_score && item.relevance_score >= 50) ? '中' : '低'),
            focus_area: (item.search_keywords || []).slice(0,2).join(', ') || 'N/A',
            monitoring_status: item.monitoring_status
        };
    } else if (registryKey === 'user_accounts' && item) {
        return {
            id: item.user_email,
            user_email: item.user_email,
            display_name: item.display_name,
            role_id: item.role_id,
            status: item.status
        };
    }
    // 对于其他，直接返回原始对象
    return item;
  },

  /**
   * [API] 根据ID列表批量获取实体基本信息。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string[]} entityIds - 要查询的实体ID数组。
   * @returns {Array<object>} [{id: string, name: string}]
   */
  getEntitiesByIds: function(authInfo, entityIds) {
    if (!entityIds || !Array.isArray(entityIds) || entityIds.length === 0) {
      return [];
    }
    
    // Firestore 的 'in' 查询最多支持10个ID，如果超过需要分批
    // 这里为了简化，我们先假设不超过10个，或者在DataService中处理分批
    const entities = DataService.getDataAsObjects('REG_ENTITIES', {
      filters: [{ field: 'entity_id', operator: 'IN', value: entityIds }]
    });

    return (entities || []).map(e => ({ id: e.entity_id, name: e.primary_name }));
  },

  /**
   * [API] 根据关键词搜索实体，用于前端动态搜索下拉框。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   * @param {string} entityType - 要搜索的实体类型 (e.g., 'Technology', 'Company').
   * @param {string} keyword - 用户输入的搜索关键词。
   * @param {number} limit - 返回结果的最大数量。
   * @returns {Array<object>} [{id: string, name: string}]
   */
  searchEntities: function(authInfo, entityType, keyword, limit = 20) {
    if (!entityType || !keyword) {
      return [];
    }
    
    // Firestore 不直接支持高效的、不区分大小写的'CONTAINS'或'STARTS_WITH'查询。
    // 在大规模应用中，通常会结合第三方搜索服务（如 Algolia, Elasticsearch）。
    // 在当前架构下，我们采用一种“获取后过滤”的折中方案，它在几千条记录内性能尚可。
    
    // 1. 先获取该类型的所有实体
    const allEntitiesOfType = DataService.getDataAsObjects('REG_ENTITIES', {
      filters: [{ field: 'entity_type', operator: 'EQUAL', value: entityType }]
    }) || [];

    // 2. 在内存中进行不区分大小写的模糊匹配
    const lowerCaseKeyword = keyword.toLowerCase();
    const results = allEntitiesOfType.filter(entity => 
      (entity.primary_name && entity.primary_name.toLowerCase().includes(lowerCaseKeyword)) ||
      (entity.aliases && entity.aliases.some(alias => String(alias).toLowerCase().includes(lowerCaseKeyword)))
    ).slice(0, limit); // 只返回限定数量的结果

    // 3. 格式化为前端需要的格式
    return results.map(e => ({ id: e.entity_id, name: e.primary_name }));
  },

  /**
   * [API] 通用方法：更新或插入注册表中的单个条目。
   * 匹配 mock_api.js -> SystemAdminService.saveRegistryItem
   */
  saveRegistryItem: function(authInfo, registryKey, itemData) {
    if (!CONFIG.FIRESTORE_COLLECTIONS[registryKey] || !registryKey.startsWith('REG_') && registryKey !== 'automation_tasks' && registryKey !== 'report_templates') {
      throw new Error(`无效或非法的注册表键名: ${registryKey}`);
    }
    
    let collectionName = CONFIG.FIRESTORE_COLLECTIONS[registryKey] || registryKey;
    let idField;
    let processedItemData = { ...itemData }; // 复制一份进行修改

    if (registryKey === 'technology_registry') {
        idField = 'entity_id';
        processedItemData.entity_type = 'Technology';
        processedItemData.primary_name = itemData.tech_name;
        processedItemData.search_keywords = itemData.tech_keywords ? itemData.tech_keywords.split(',').map(s => s.trim()) : [];
        delete processedItemData.tech_name;
        delete processedItemData.tech_keywords;
    } else if (registryKey === 'competitor_registry') {
        idField = 'entity_id';
        processedItemData.entity_type = 'Company';
        processedItemData.primary_name = itemData.company_name;
        processedItemData.category = itemData.industry;
        processedItemData.relevance_score = (itemData.priority === '高') ? 85 : ((itemData.priority === '中') ? 60 : 30);
        processedItemData.search_keywords = itemData.focus_area ? itemData.focus_area.split(',').map(s => s.trim()) : [];
        delete processedItemData.company_name;
        delete processedItemData.industry;
        delete processedItemData.priority;
        delete processedItemData.focus_area;
    } else if (registryKey === 'user_accounts') {
        idField = 'user_email';
    } else {
        idField = 'id'; // 默认id字段
    }

    processedItemData.updated_timestamp = new Date();
    if (!processedItemData.created_timestamp) {
      processedItemData.created_timestamp = new Date();
    }
    
    DataService.batchUpsert(collectionName, [processedItemData], idField);
    return { success: true, message: "条目已更新。", item: processedItemData };
  },

  /**
   * [API] 通用方法：删除注册表中的单个条目。
   * 匹配 mock_api.js -> SystemAdminService.deleteRegistryItem
   */
  deleteRegistryItem: function(authInfo, registryKey, itemId) {
    if (!CONFIG.FIRESTORE_COLLECTIONS[registryKey] || !registryKey.startsWith('REG_') && registryKey !== 'automation_tasks' && registryKey !== 'report_templates') {
      throw new Error(`无效或非法的注册表键名: ${registryKey}`);
    }
    let collectionName = CONFIG.FIRESTORE_COLLECTIONS[registryKey] || registryKey;
    DataService.deleteObject(collectionName, itemId);
    return { success: true, message: "条目已删除。" };
  },

  //==================================================================
  // SECTION 3: 特定注册表数据选择器
  //==================================================================

  /**
   * [API] 获取所有技术实体选项，用于前端下拉框。
   * 匹配 mock_api.js -> SystemAdminService.getTechOptions
   * @returns {Array<object>} [{id: string, name: string}]
   */
  getTechOptions: function(authInfo) {
    const techs = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [{ field: 'entity_type', operator: 'EQUAL', value: 'Technology' }],
        orderBy: { field: 'primary_name', direction: 'ASCENDING' }
    }) || [];
    return techs.map(t => ({ id: t.entity_id, name: t.primary_name }));
  },

  /**
   * [API] 获取所有公司实体选项，用于前端下拉框。
   * 匹配 mock_api.js -> SystemAdminService.getCompetitorOptions
   * @returns {Array<object>} [{id: string, name: string}]
   */
  getCompetitorOptions: function(authInfo) {
    const companies = DataService.getDataAsObjects('REG_ENTITIES', {
        filters: [{ field: 'entity_type', operator: 'EQUAL', value: 'Company' }],
        orderBy: { field: 'primary_name', direction: 'ASCENDING' }
    }) || [];
    return companies.map(c => ({ id: c.entity_id, name: c.primary_name }));
  },

  /**
   * [API] 获取单个用户账户信息。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  getUserAccountByEmail: function(authInfo, userEmail) {
    const user = DataService.getDocument('REG_USERS', userEmail);
    if (!user) {
        Logger.log(`[RegistryService] User ${userEmail} not found in REG_USERS.`);
        return { user_email: userEmail, display_name: '未知用户', role_id: 'guest', effective_focus: { focusedTechIds: [], focusedCompetitorIds: [] } };
    }

    // 假设用户的关注列表直接存储在用户文档中
    const effectiveFocus = {
        focusedTechIds: user.custom_tech_focus_ids || [],
        focusedCompetitorIds: user.custom_competitor_focus_ids || []
    };

    return {
        user_email: user.user_email,
        display_name: user.display_name,
        role_id: user.role_id,
        effective_focus: effectiveFocus
    };
  },

  /**
   * [API] 保存用户关注列表。
   * @param {object} authInfo - 由API网关注入的用户认证信息。
   */
  saveUserFocus: function(authInfo, focusData) {
    const userEmail = focusData.user_email;
    if (!userEmail) throw new Error("User email is required to save focus.");

    DataService.updateObject('REG_USERS', userEmail, {
        custom_tech_focus_ids: focusData.focusedTechIds,
        custom_competitor_focus_ids: focusData.focusedCompetitorIds,
        updated_timestamp: new Date()
    });
    return { success: true };
  }
};
