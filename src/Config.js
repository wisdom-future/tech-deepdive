/**
 * @file Config.gs
 * @description 全局配置文件，定义了系统中所有核心常量和映射关系。
 * 这是整个项目的“单一事实来源”，所有模块都应引用此处的键名。
 */

const CONFIG = {
  /**
   * Firestore 集合名称的最终映射。
   * 命名规范: [层级前缀]_[逻辑分组]_[具体内容]
   * - REG: Registry - 系统的核心配置与注册表
   * - QUEUE: Queue - 异步处理任务队列
   * - EVD: Evidence - 经过处理的、可作为证据的原始数据
   * - FND: Finding - 从证据中提炼出的发现或信号
   * - KG: Knowledge Graph - 知识图谱的节点与边
   * - ANL: Analytics - 预计算的、用于分析和可视化的数据
   * - LOG: Log & Ops - 系统运行日志与操作历史
   */
  FIRESTORE_COLLECTIONS: {
    //================================================
    // REGISTRY LAYER (核心配置与注册表)
    //================================================
    'REG_ENTITIES': 'registry_entities',
    'REG_SOURCES': 'registry_sources',
    'REG_USERS': 'registry_users',
    'REG_ROLES': 'registry_roles',

    //================================================
    // QUEUE LAYER (任务队列)
    //================================================
    'QUEUE_TASKS': 'queue_processing_tasks',

    //================================================
    // EVIDENCE LAYER (处理后的证据数据)
    //================================================
    'EVD_NEWS': 'evidence_news',
    'EVD_PAPERS': 'evidence_academic_papers',
    'EVD_PATENTS': 'evidence_patents',
    'EVD_OPENSOURCE': 'evidence_opensource_projects',
    'EVD_JOBS': 'evidence_talent_flows',
    'EVD_REPORTS': 'evidence_analyst_reports',
    'EVD_FILINGS': 'evidence_corporate_filings',
    'EVD_DYNAMICS': 'evidence_industry_dynamics',
    'EVD_VIDEOS': 'evidence_video_content',
    'EVD_POLICIES': 'evidence_policy_updates',
    'EVD_COMPETITOR': 'evidence_competitor_signals',

    //================================================
    // FINDING LAYER (提炼出的发现/信号)
    //================================================
    'FND_MASTER': 'findings_master',

    //================================================
    // KNOWLEDGE GRAPH LAYER (知识图谱)
    //================================================
    'KG_NODES': 'registry_entities', // 节点复用实体注册表
    'KG_EDGES': 'graph_relationships',

    //================================================
    // ANALYTICS LAYER (分析与快照)
    //================================================
    'ANL_DAILY_SNAPSHOTS': 'analytics_daily_snapshots',

    //================================================
    // LOG & OPS LAYER (日志与操作历史)
    //================================================
    'LOG_WORKFLOWS': 'log_workflow_executions',
    'LOG_REPORTS_HISTORY': 'log_reports_history',
    'LOG_DATA_QUALITY': 'log_data_quality_reports',
    'LOG_REJECTED_DATA': 'log_rejected_raw_data'
  },
  
  /**
   * 性能与缓存相关的配置。
   */
  PERFORMANCE: {
    // 缓存有效期（秒）
    CACHE_DURATION_SECONDS: 300, 
    // API调用失败时的重试次数
    RETRY_ATTEMPTS: 3,
    // 每次重试之间的延迟（毫秒）
    RETRY_DELAY_MS: 1000
  },
  
  /**
   * 当前运行环境配置。
   * 'DEVELOPMENT' 或 'PRODUCTION'
   */
  ENVIRONMENT: {
    // 当前环境
    ENV: 'DEVELOPMENT', 
    // 在开发环境中是否使用模拟API数据
    USE_MOCK_API: true,
    // 是否启用GCP云功能进行后台处理
    USE_GCP_SERVICES: false
  }
};
