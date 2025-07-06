// =======================================================================
//  【最终完整版】ConfigDataService - 请替换 backend/svc.ConfigData.gs 的全部内容
// =======================================================================

/**
 * @file 配置数据服务，负责从Config_DB中读取各种配置信息。
 * 版本：6.0 - 最终版，包含所有统计和详情函数，并修复了Date对象序列化问题。
 */
const ConfigDataService = {

  /**
   * 辅助函数：安全地将Date对象转换为 "YYYY-MM-DD" 格式的字符串。
   * @param {any} dateValue - 可能为Date对象或其他类型的值。
   * @returns {string | any} - 如果是Date对象，返回格式化后的字符串；否则返回原值。
   */
  _formatDateToString: function(dateValue) {
    if (dateValue instanceof Date) {
      // toISOString() 返回 "YYYY-MM-DDTHH:mm:ss.sssZ"
      // .split('T')[0] 取出 "YYYY-MM-DD" 部分
      return dateValue.toISOString().split('T')[0];
    }
    return dateValue; // 如果不是Date对象，直接返回原值
  },

  //================================================
  // 统计函数 (STATS)
  //================================================

  getTechnologyDomainStats() {
    try {
      const techRegistry = DataService.getDataAsObjects('TECH_REGISTRY');
      const total = techRegistry.length;
      const active = techRegistry.filter(item => String(item.monitoring_status || '').toLowerCase() === 'active').length;
      return { total, active };
    } catch (e) {
      throw new Error(`获取技术领域统计失败: ${e.message}`);
    }
  },

  getIndustryBenchmarkStats() {
    try {
      const competitorRegistry = DataService.getDataAsObjects('COMPETITOR_REGISTRY');
      const total = competitorRegistry.length;
      const focus = competitorRegistry.filter(item => {
        const priority = String(item.monitoring_priority || '').toLowerCase();
        return priority === 'high' || priority === 'critical';
      }).length;
      return { total, focus };
    } catch (e) {
      throw new Error(`获取业界标杆统计失败: ${e.message}`);
    }
  },

  getConferenceStats() {
    try {
      const conferenceRegistry = DataService.getDataAsObjects('CONFERENCE_REGISTRY');
      const total = conferenceRegistry.length;
      const monitoring = conferenceRegistry.filter(item => String(item.monitoring_status || '').toLowerCase() === 'active').length;
      return { total, monitoring };
    } catch (e) {
      throw new Error(`获取学术顶会统计失败: ${e.message}`);
    }
  },

  //================================================
  // 详情获取函数 (DETAILS)
  //================================================
  getTechnologyDomainDetails() {
    try {
      const rawData = DataService.getDataAsObjects('TECH_REGISTRY');
      if (!rawData) return []; // 如果没数据，返回空数组
      
      return rawData.map(item => ({
        tech_id: item.tech_id,
        tech_name: item.tech_name,
        tech_category: item.tech_category,
        monitoring_status: item.monitoring_status,
        created_date: this._formatDateToString(item.created_date),
        website_url: item.website_url, // 确保返回所有前端适配器需要的字段
      }));
    } catch (e) {
      const errorMessage = `获取技术领域详情时发生服务器错误: ${e.message}`;
      Logger.log(errorMessage + `\n${e.stack}`);
      throw new Error(errorMessage);
    }
  },

  /**
   * ✅ 修正版：返回英文键名，并正确抛出错误
   */
  getIndustryBenchmarkDetails() {
    try {
      const rawData = DataService.getDataAsObjects('COMPETITOR_REGISTRY');
      if (!rawData) return [];

      return rawData.map(item => ({
        competitor_id: item.competitor_id,
        company_name: item.company_name,
        industry_category: item.industry_category,
        threat_level: item.threat_level,
        monitoring_status: item.monitoring_status,
        founded_year: item.founded_year,
        last_updated: this._formatDateToString(item.last_updated),
        website_url: item.website_url
      }));
    } catch (e) {
      const errorMessage = `获取业界标杆详情时发生服务器错误: ${e.message}`;
      Logger.log(errorMessage + `\n${e.stack}`);
      throw new Error(errorMessage);
    }
  },

  getIndustryBenchmarkDetails: function() {
    try {
      const rawData = DataService.getDataAsObjects('COMPETITOR_REGISTRY');
      if (!rawData) return [];

      // 直接返回从数据库获取的、包含所有字段的对象数组
      // 前端将根据需要选择字段进行显示
      return rawData;

    } catch (e) {
      const errorMessage = `获取业界标杆详情时发生服务器错误: ${e.message}`;
      Logger.log(errorMessage + `\n${e.stack}`);
      // 抛出一个错误，让前端的 .catch() 能够捕获到
      throw new Error(errorMessage);
    }
  },

  /**
   * ✅ 修正版：返回英文键名，并正确抛出错误
   */
  getConferenceDetails() {
    try {
      const rawData = DataService.getDataAsObjects('CONFERENCE_REGISTRY');
      if (!rawData) return [];
      
      return rawData.map(item => ({
        conference_id: item.conference_id,
        conference_name: item.conference_name,
        industry_focus: item.industry_focus,
        next_event_date: this._formatDateToString(item.next_event_date),
        monitoring_status: item.monitoring_status,
        official_website: item.official_website
      }));
    } catch (e) {
      const errorMessage = `获取学术顶会详情时发生服务器错误: ${e.message}`;
      Logger.log(errorMessage + `\n${e.stack}`);
      throw new Error(errorMessage);
    }
  }
};

// =======================================================================
//  测试函数 (保持不变)
// =======================================================================

/**
 * [DEBUG] 统一测试 ConfigDataService 的所有统计函数
 */
function test_All_ConfigDataService_Stats() {
  Logger.log("====== 开始测试 ConfigDataService (统计) ======");
  try {
    const techStats = ConfigDataService.getTechnologyDomainStats();
    Logger.log(`✅ 技术领域统计: ${JSON.stringify(techStats)}`);
  } catch (e) {
    Logger.log(`❌ 获取技术领域统计失败: ${e.message}`);
  }
  // ... 其他统计测试
  Logger.log("====== ConfigDataService (统计) 测试结束 ======");
}

/**
 * [DEBUG] 统一测试 ConfigDataService 的所有详情函数
 */
function test_All_ConfigDataService_Details() {
  Logger.log("====== 开始测试 ConfigDataService (详情) ======");
  try {
    const details = ConfigDataService.getConferenceDetails();
    Logger.log(`✅ 获取到的会议详情数据 (${details.length} 条):`);
    Logger.log(JSON.stringify(details.slice(0, 3), null, 2)); 
  } catch (e) {
    Logger.log(`❌ 获取会议详情失败: ${e.message}`);
  }
  // ... 其他详情测试
  Logger.log("====== ConfigDataService (详情) 测试结束 ======");
}
