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
    RAW_ACADEMIC_PAPERS: 'Raw_Academic_Papers', // 新增
    RAW_PATENT_DATA: 'Raw_Patent_Data',         // 新增
    RAW_OPENSOURCE_DATA: 'Raw_OpenSource_Data', // 新增
    RAW_TECH_NEWS: 'Raw_Tech_News',             // 新增
    RAW_INDUSTRY_DYNAMICS: 'Raw_Industry_Dynamics', // 新增
    RAW_COMPETITOR_INTELLIGENCE: 'Raw_Competitor_Intelligence', // 新增
    
    // Intelligence DB
    TECH_INSIGHTS_MASTER: 'Tech_Intelligence_Master',
    EVIDENCE_VALIDATION: 'Evidence_Validation_Matrix',
    
    // Operations DB
    WORKFLOW_LOG: 'Workflow_Execution_Log',
    DATA_QUALITY_REPORTS: 'Data_Quality_Reports',
    REPORTS_HISTORY: 'Reports_History'
    // ... 在此添加其他所有表名
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
   * 当前运行环境。
   * 'DEVELOPMENT' 模式下可能会输出更多日志或使用测试数据。
   * 'PRODUCTION' 模式下会更注重性能和错误抑制。
   */
  ENV: 'DEVELOPMENT' 
};
