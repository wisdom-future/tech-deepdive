// 文件名: backend/svc.RawDataStats.gs

/** @global CONFIG */
/** @global DataService */
/** @global SpreadsheetApp */
/** @global DateUtils */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

/**
 * @file 原始数据统计服务。
 * 负责从原始数据表中获取各种统计信息。
 * 版本：1.0 - 优化了数据获取逻辑，避免"Argument too large"错误。
 */

const RawDataStatsService = {
  /**
   * 安全地获取工作表数据行数（不包含两行表头）。
   * 这是解决Apps Script "Argument too large"的关键策略。
   * 对于非常大的表，Apps Script不适合直接读取并计数。
   * 长期方案：Make工作流预计算并将统计结果写入一个小的、Apps Script可读的汇总表。
   * @param {string} dbId - 数据库ID。
   * @param {string} sheetName - 表名。
   * @returns {number} 工作表的数据行数。
   */
  _getSheetDataRowCount(dbId, sheetName) {
    try {
      const spreadsheet = SpreadsheetApp.openById(dbId);
      const sheet = spreadsheet.getSheetByName(sheetName);
      if (!sheet) {
        logWarning(`[RawDataStatsService] _getSheetDataRowCount: Sheet "${sheetName}" not found in DB. Returning 0 rows.`);
        return 0;
      }
      // Directly get the last row index of the sheet, this is the safest counting method, won't trigger Argument too large
      const lastRow = sheet.getLastRow();
      // Subtract two header rows, return 0 if result is negative
      return Math.max(0, lastRow - 2); 
    } catch (e) {
      logError(`[RawDataStatsService] Error in _getSheetDataRowCount for ${sheetName}: ${e.message}\n${e.stack}`);
      // To prevent the entire application from crashing due to internal Apps Script errors, return 0
      return 0; 
    }
  },

  /**
   * 获取所有原始数据源的统计信息。
   * @returns {Object} 包含原始数据总览和分类统计的对象。
   */
  getStats() {
    try {
      // Use _getSheetDataRowCount to get real row counts, avoiding Argument too large
      const academicPapersCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS);
      const patentDataCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA);
      const openSourceDataCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA);
      const techNewsCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS);
      const industryDynamicsCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS);
      const competitorIntelligenceCount = this._getSheetDataRowCount(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE);
      
      // Count total raw data
      const totalRawData = academicPapersCount + patentDataCount + openSourceDataCount + techNewsCount + industryDynamicsCount + competitorIntelligenceCount;
      
      // 'Today's Update' requires iterating through data, which may be limited by Apps Script.
      // Suggestion: Make workflows calculate daily increments at the end of each day and write them to a small statistics table for Apps Script to read.
      const todayUpdated = 0; 

      return {
        total: totalRawData,
        todayUpdated: todayUpdated,
        categories: {
          academicPapers: academicPapersCount,
          patentData: patentDataCount,
          openSourceData: openSourceDataCount,
          techNews: techNewsCount,
          industryDynamics: industryDynamicsCount,
          competitorIntelligence: competitorIntelligenceCount
        }
      };
    } catch (e) {
      logError(`[RawDataStatsService] Error in RawDataStatsService.getStats: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取原始数据统计: ${e.message}`); 
    }
  }
};

// ==================================================================================
//  T E S T   C O D E
// ==================================================================================

/**
 * 测试 RawDataStatsService 核心功能。
 */
function test_RawDataStatsService() {
  logInfo("======== 开始测试 RawDataStatsService ========");
  try {
    const stats = RawDataStatsService.getStats();
    logInfo("✅ 成功获取原始数据统计:");
    logInfo(JSON.stringify(stats, null, 2));
    
    // Simple assertion
    if (typeof stats.total === 'number' && stats.total >= 0) {
      logInfo("✅ 统计数据格式正确。");
    } else {
      logInfo("❌ 统计数据格式不正确。");
    }

  } catch (e) {
    logError(`❌ RawDataStatsService 测试失败: ${e.message} \n ${e.stack}`);
  }
  logInfo("\n======== RawDataStatsService 测试结束 ========");
}