// 文件名: Config.gs

/**
 * @file 全局配置文件，管理所有硬编码值和系统设置。
 */

const CONFIG = {
  /**
   * 数据库Google Sheets文件的ID。
   * 务必将占位符替换为您的真实ID。
   */
  DATABASE_IDS: {
    CONFIG_DB: '14jCzQclmFaHRH8iHrYt9v2Tk-bZ8TVrvbhXUZyFITNE',
    RAWDATA_DB: '17CSJX53IF628jsaZbtab2rCaVhi71DRCSKUOQnRKyoU',
    INTELLIGENCE_DB: '1B9WQzSL56TY04E-633Io3A1X5AWmPr8XypGiU92OXu0',
    OPERATIONS_DB: '1ht0-r9yyIYd7I_ULubkKbKTVgxablvfyJgz09DfbKXk'
  },
  
  /**
   * Google Drive中特定文件夹的ID。
   * 务必将占位符替换为您的真实ID。
   */
  DRIVE_FOLDERS: {
    REPORTS_OUTPUT: '1fkVdmHmnuQnSdzorka0UPw4l6MapKhxo' // 替换为你的报告输出文件夹ID
  },

  /**
   * 数据库中各个表的标准名称。
   */
  SHEET_NAMES: {
    // Config DB
    TECH_REGISTRY: 'Technology_Registry',
    COMPETITOR_REGISTRY: 'Competitor_Registry',
    CONFERENCE_REGISTRY: 'Conference_Registry', 
    REPORT_RECIPIENTS: 'Report_Recipients', 
    SCHEDULED_REPORTS_CONFIG: 'Scheduled_Reports_Config',

    // Raw Data DB
    RAW_ACADEMIC_PAPERS: 'Raw_Academic_Papers', // New
    RAW_PATENT_DATA: 'Raw_Patent_Data',         // New
    RAW_OPENSOURCE_DATA: 'Raw_OpenSource_Data', // New
    RAW_TECH_NEWS: 'Raw_Tech_News',             // New
    RAW_INDUSTRY_DYNAMICS: 'Raw_Industry_Dynamics', // New
    RAW_COMPETITOR_INTELLIGENCE: 'Raw_Competitor_Intelligence', // New
    
    // Intelligence DB
    TECH_INSIGHTS_MASTER: 'Tech_Intelligence_Master',
    EVIDENCE_VALIDATION: 'Evidence_Validation_Matrix',
    
    // Operations DB
    WORKFLOW_LOG: 'Workflow_Execution_Log',
    DATA_QUALITY_REPORTS: 'Data_Quality_Reports',
    REPORTS_HISTORY: 'Reports_History'
    // ... Add other sheet names here
  },
  


  /**
   * 性能与缓存相关的配置。
   */
  PERFORMANCE: {
    CACHE_DURATION_SECONDS: 300, // 缓存有效期5分钟
    RETRY_ATTEMPTS: 3,           // API调用失败重试次数
    RETRY_DELAY_MS: 1000         // 重试间隔（毫秒）
  },
  
  /**
   * Current running environment.
   * 'DEVELOPMENT' mode may output more logs or use test data.
   * 'PRODUCTION' mode will focus more on performance and error suppression.
   */
  ENV: 'DEVELOPMENT', // Set to 'PRODUCTION' for deployment

  /**
   * Log level for backend functions. 
   * 'DEBUG': Most verbose, includes development logs.
   * 'INFO': Standard operational logs.
   * 'WARNING': Potential issues.
   * 'ERROR': Only critical errors.
   */
  LOG_LEVEL: 'DEBUG' // Can be 'INFO', 'WARNING', 'ERROR' in PRODUCTION
};