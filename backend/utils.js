// 文件名: backend/utils.gs

/** @global CONFIG */

/**
 * @file 全局工具函数库，包含日期处理和日志封装。
 */

const DateUtils = {
  /**
   * 格式化日期对象或日期字符串为指定格式的字符串。
   * 支持 'yyyy-MM-dd' 和 'yyyy-MM-dd HH:mm:ss' 两种格式。
   * @param {Date|string|number} dateValue - 要格式化的日期值。可以是Date对象、日期字符串或时间戳。
   * @param {boolean} [includeTime=false] - 是否包含时间部分。
   * @param {string} [formatString] - 可选的自定义格式字符串 (例如 'yyyy年MM月dd日 HH:mm:ss')。
   * @returns {string} 格式化后的日期字符串，如果日期无效则返回 'N/A'。
   */
  formatDate: function(dateValue, includeTime = false, formatString = null) {
    if (!dateValue) return 'N/A';

    let dateObj;
    if (dateValue instanceof Date) {
      dateObj = dateValue;
    } else {
      // 尝试解析字符串或数字为Date对象
      dateObj = new Date(dateValue);
    }

    if (isNaN(dateObj.getTime())) {
      // 如果解析失败，则返回原始值或指定错误提示
      return String(dateValue); // 或者返回 'Invalid Date'
    }

    const format = formatString || (includeTime ? 'yyyy-MM-dd HH:mm:ss' : 'yyyy-MM-dd');
    return Utilities.formatDate(dateObj, Session.getScriptTimeZone(), format);
  },

  /**
   * 将日期字符串解析为Date对象。
   * 尝试处理多种常见的日期字符串格式，但主要依赖Date构造函数。
   * @param {string|Date} dateString - 要解析的日期字符串或Date对象。
   * @returns {Date|null} 解析后的Date对象，如果解析失败则返回null。
   */
  parseDate: function(dateString) {
    if (!dateString) return null;
    if (dateString instanceof Date) return dateString;

    const dateObj = new Date(dateString);
    if (isNaN(dateObj.getTime())) {
      // 尝试处理 "YYYY-MM-DD" 格式可能导致的时区问题，将其视为UTC
      const parts = String(dateString).match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (parts) {
        // new Date(year, monthIndex, day) 默认在本地时区创建
        // new Date(Date.UTC(year, monthIndex, day)) 在UTC创建
        // 根据需要选择，这里为了避免本地时区影响，直接使用ISO格式
        const utcDateObj = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T00:00:00Z`);
        if (!isNaN(utcDateObj.getTime())) {
          return utcDateObj;
        }
      }
      return null;
    }
    return dateObj;
  },

  /**
   * 安全地将对象数组中的所有Date对象转换为YYYY-MM-DD格式的字符串。
   * @param {Array<Object>} dataArray - 包含可能Date对象的对象数组。
   * @returns {Array<Object>} - 日期已格式化为字符串的新数组。
   */
  formatDatesInObjectsArray: function(dataArray) {
    if (!Array.isArray(dataArray)) return [];
    return dataArray.map(row => {
      const newRow = {};
      for (const key in row) {
        if (row[key] instanceof Date) {
          newRow[key] = this.formatDate(row[key]);
        } else {
          newRow[key] = row[key];
        }
      }
      return newRow;
    });
  }
};

/**
 * 后端日志函数 - 调试级别。
 * 仅当 CONFIG.LOG_LEVEL 为 'DEBUG' 时输出。
 * @param {string} message - 日志消息。
 */
function logDebug(message) {
  if (CONFIG.LOG_LEVEL === 'DEBUG') {
    Logger.log(`[DEBUG] ${message}`);
  }
}

/**
 * 后端日志函数 - 信息级别。
 * 当 CONFIG.LOG_LEVEL 为 'DEBUG' 或 'INFO' 时输出。
 * @param {string} message - 日志消息。
 */
function logInfo(message) {
  if (CONFIG.LOG_LEVEL === 'DEBUG' || CONFIG.LOG_LEVEL === 'INFO') {
    Logger.log(`[INFO] ${message}`);
  }
}

/**
 * 后端日志函数 - 警告级别。
 * 当 CONFIG.LOG_LEVEL 为 'DEBUG', 'INFO' 或 'WARNING' 时输出。
 * @param {string} message - 日志消息。
 */
function logWarning(message) {
  if (CONFIG.LOG_LEVEL === 'DEBUG' || CONFIG.LOG_LEVEL === 'INFO' || CONFIG.LOG_LEVEL === 'WARNING') {
    Logger.log(`[WARNING] ${message}`);
  }
}

/**
 * 后端日志函数 - 错误级别。
 * 总是输出。
 * @param {string} message - 日志消息。
 */
function logError(message) {
  Logger.log(`[ERROR] ${message}`); // Errors are always logged
}