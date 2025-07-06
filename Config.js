// 文件名: Config.gs (修改后)

const CONFIG = {
  /**
   * Firestore 集合名称的映射。
   * 使用逻辑键名，方便在代码中引用。
   */
  FIRESTORE_COLLECTIONS: {
    // Config Data
    TECH_REGISTRY: 'technology_registry',
    COMPETITOR_REGISTRY: 'competitor_registry',
    CONFERENCE_REGISTRY: 'conference_registry',
    REPORT_RECIPIENTS: 'report_recipients',
    SCHEDULED_REPORTS_CONFIG: 'scheduled_reports_config',

    // Raw Data
    RAW_ACADEMIC_PAPERS: 'raw_academic_papers',
    RAW_PATENT_DATA: 'raw_patent_data',
    RAW_OPENSOURCE_DATA: 'raw_opensource_data',
    RAW_TECH_NEWS: 'raw_tech_news',
    RAW_INDUSTRY_DYNAMICS: 'raw_industry_dynamics',
    RAW_COMPETITOR_INTELLIGENCE: 'raw_competitor_intelligence',
    
    // Intelligence Data
    TECH_INSIGHTS_MASTER: 'tech_intelligence_master',
    EVIDENCE_VALIDATION: 'evidence_validation_matrix',
    
    // Operations Data
    WORKFLOW_LOG: 'workflow_execution_log',
    AUTHORS_REGISTRY: 'authors',
    AFFILIATIONS_REGISTRY: 'affiliations',
    DATA_QUALITY_REPORTS: 'data_quality_reports',
    REPORTS_HISTORY: 'reports_history'
  },
  
  /**
   * 性能与缓存相关的配置 (保持不变)。
   */
  PERFORMANCE: {
    CACHE_DURATION_SECONDS: 300,
    RETRY_ATTEMPTS: 3,
    RETRY_DELAY_MS: 1000
  },
  
  /**
   * 当前运行环境 (保持不变)。
   */
  ENV: 'DEVELOPMENT' 
};
