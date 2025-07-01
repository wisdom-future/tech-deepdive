// 文件名: backend/svc.RawDataStats.gs

/**
 * @file 原始数据统计服务。
 * 负责从原始数据表中获取各种统计信息。
 * 版本：1.0 - 优化了数据获取逻辑，避免"Argument too large"错误。
 */

const RawDataStatsService = {
    /**
   * 安全地获取工作表数据行数（不包含两行表头）。
   * @param {string} dbId - 数据库ID。
   * @param {string} sheetName - 表名。
   * @returns {number} 工作表的数据行数。
   */
  _getSheetDataRowCount(dbId, sheetName) {
    try {
      const spreadsheet = SpreadsheetApp.openById(dbId);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        Logger.log(`Warning: _getSheetDataRowCount: Sheet "${sheetName}" not found in DB. Returning 0 rows.`);
        return 0;
      }
      const lastRow = sheet.getLastRow();
      return Math.max(0, lastRow - 2); 
    } catch (e) {
      Logger.log(`Error in _getSheetDataRowCount for ${sheetName}: ${e.message}`);
      return 0; 
    }
  },

  /**
   * **新增：计算指定Sheet的近7日采集数量**
   * @param {string} dbId - 数据库ID。
   * @param {string} sheetName - 表名。
   * @param {string} ingestionDateField - 记录采集时间的字段名 (e.g., 'created_timestamp')。
   * @returns {number} 近7日采集数量。
   */
  _getSevenDayIngestionCount(dbId, sheetName, ingestionDateField = 'created_timestamp') {
    try {
      const allData = DataService.getDataAsObjects(dbId, sheetName); // 获取所有数据
      if (!allData || allData.length === 0) {
        return 0;
      }

      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const sevenDaysAgo = new Date(today);
      sevenDaysAgo.setDate(today.getDate() - 6); // 过去7天：包括今天和前6天

      const count = allData.filter(item => {
        const val = item[ingestionDateField];
        if (!val) return false;

        const itemDate = new Date(val); // 尝试将值转换为日期对象
        return !isNaN(itemDate.getTime()) && itemDate >= sevenDaysAgo && itemDate <= today;
      }).length;
      
      return count;

    } catch (e) {
      Logger.log(`Error in _getSevenDayIngestionCount for ${sheetName}: ${e.message}`);
      return 0;
    }
  },

  /**
   * 获取所有原始数据源的统计信息。
   * @returns {Object} 包含原始数据总览和分类统计的对象。
   */
  getStats() {
    try {
      // 定义采集时间字段映射
      const ingestionDateFieldMap = {
          RAW_ACADEMIC_PAPERS: 'created_timestamp', 
          RAW_PATENT_DATA: 'created_timestamp',     
          RAW_OPENSOURCE_DATA: 'created_timestamp', 
          RAW_TECH_NEWS: 'created_timestamp',       
          RAW_INDUSTRY_DYNAMICS: 'created_timestamp', 
          RAW_COMPETITOR_INTELLIGENCE: 'created_timestamp'
      };

      // 获取每个类别的总数
      const academicPapersTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS);
      const patentDataTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA);
      const openSourceDataTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA);
      const techNewsTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS);
      const industryDynamicsTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS);
      const competitorIntelligenceTotal = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE);
      
      // 获取每个类别的近7日采集数量
      const academicPapersSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS, ingestionDateFieldMap.RAW_ACADEMIC_PAPERS);
      const patentDataSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA, ingestionDateFieldMap.RAW_PATENT_DATA);
      const openSourceDataSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA, ingestionDateFieldMap.RAW_OPENSOURCE_DATA);
      const techNewsSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS, ingestionDateFieldMap.RAW_TECH_NEWS);
      const industryDynamicsSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS, ingestionDateFieldMap.RAW_INDUSTRY_DYNAMICS);
      const competitorIntelligenceSevenDay = this._getSevenDayIngestionCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE, ingestionDateFieldMap.RAW_COMPETITOR_INTELLIGENCE);

      // 统计总数和总近7日采集
      const totalRawData = academicPapersTotal + patentDataTotal + openSourceDataTotal + techNewsTotal + industryDynamicsTotal + competitorIntelligenceTotal;
      const totalSevenDayIngestion = academicPapersSevenDay + patentDataSevenDay + openSourceDataSevenDay + techNewsSevenDay + industryDynamicsSevenDay + competitorIntelligenceSevenDay;

      return {
        total: totalRawData,
        sevenDayIngestion: totalSevenDayIngestion, // **新增：总近7日采集**
        todayUpdated: 0, // 这个字段现在可以废弃或重新定义
        categories: {
          academicPapers: academicPapersTotal,
          patentData: patentDataTotal,
          openSourceData: openSourceDataTotal,
          techNews: techNewsTotal,
          industryDynamics: industryDynamicsTotal,
          competitorIntelligence: competitorIntelligenceTotal
        },
        sevenDayCategories: { // **新增：各类别近7日采集**
          academicPapers: academicPapersSevenDay,
          patentData: patentDataSevenDay,
          openSourceData: openSourceDataSevenDay,
          techNews: techNewsSevenDay,
          industryDynamics: industryDynamicsSevenDay,
          competitorIntelligence: competitorIntelligenceSevenDay
        }
      };
    } catch (e) {
      Logger.log(`Error in RawDataStatsService.getStats: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取原始数据统计: ${e.message}`); 
    }
  }
};

// ====================================================================
//  T E S T   C O D E
// ====================================================================

/**
 * 测试 RawDataStatsService 核心功能。
 */
function test_RawDataStatsService() {
  Logger.log("======== 开始测试 RawDataStatsService ========");
  try {
    const stats = RawDataStatsService.getStats();
    Logger.log("✅ 成功获取原始数据统计:");
    Logger.log(JSON.stringify(stats, null, 2));
    
    // 简单断言
    if (typeof stats.total === 'number' && stats.total >= 0) {
      Logger.log("✅ 统计数据格式正确。");
    } else {
      Logger.log("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    Logger.log(`❌ RawDataStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  Logger.log("\n======== RawDataStatsService 测试结束 ========");
}
