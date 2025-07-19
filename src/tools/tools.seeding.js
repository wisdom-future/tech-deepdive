/**
 * @file tools.seeding.js
 * @description 存放所有数据初始化和填充(Seeding)的脚本。
 * 这些函数应在新系统部署后，在Apps Script编辑器中手动执行。
 */

//==================================================================
//  Seeding Task 1: 初始化系统角色
//==================================================================

/**
 * [可执行] 将所有预定义的外部数据源配置，写入到 'REG_SOURCES' 集合中。
 * 这个脚本是幂等的：它会更新现有配置，或创建新配置。
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
/**
 * [FINAL] 批量导入与 v25.0 代码完全匹配的、最简化的数据源配置。
 */
function populateInitialDataSourceConfigs() {
  Logger.log("--- 开始执行：填充/刷新外部数据源配置 (V10 - 包含 collection_endpoint_key 和规范化时间过滤) ---");
  try {
    const dataSourceConfigs = [
      {
        source_id: "HACKERNEWS_API",
        display_name: "Hacker News (Algolia Search)",
        source_type: "news_source,industry_dynamics_source",
        base_url: "http://hn.algolia.com",
        endpoint_paths: { "everything": "/api/v1/search", "item": "/api/v1/items/" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "none",
        api_key_name: null,
        api_key_header_name: null,
        api_key_query_param_name: null,
        request_headers: null,
        fixed_query_params: { "tags": "story" },
        is_active: true,
        priority: 90,
        notes: "通过Algolia提供的Hacker News搜索API，获取高质量技术社区讨论。",
        query_strategy: "single",
        source_credibility_rating: { "objectivity_score": 8, "tech_focus_score": 9, "political_bias_score": 3 },
        pagination_param_names: { "pageSize": "hitsPerPage", "pageNumber": "page" },
        dynamic_param_names: { "q": "query" },
        response_mapping_rules: {
            "items_path": "hits",
            "fields": { "id": "objectID", "url": "url", "title": "title", "summary": "story_text", "publication_date": "created_at", "author": "author", "points": "points", "num_comments": "num_comments" }
        },
        collection_endpoint_key: "everything",
        // ✅ 时间过滤参数：Algolia API 支持 'numericFilters=created_at_i>' + Unix时间戳
        // DataConnector 的逻辑会处理 `timeParamName.includes('=')` 这种形式
        time_filter_param_name: "numericFilters=created_at_i>",
        default_lookback_days: 7 // 默认回溯7天
      },
      {
        source_id: "SERPAPI_JOBS",
        display_name: "SerpApi Google Jobs",
        source_type: "job_search_source",
        base_url: "https://serpapi.com",
        endpoint_paths: { "query": "/search.json" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "query_param_key",
        api_key_name: "SERPAPI_KEY", // 确保在脚本属性中配置此API Key
        api_key_header_name: null,
        api_key_query_param_name: "api_key",
        request_headers: null,
        fixed_query_params: {
            "engine": "google_jobs",
            "hl": "en",
            "gl": "us"
        },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: null,
        notes: "通过SerpApi代理，搜索Google Jobs上的职位发布信息。",
        pagination_param_names: { "pageSize": "num", "pageNumber": "start" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: {
            "items_path": "jobs_results",
            "fields": {
                "id": "job_id",
                "title": "title",
                "company_name": "company_name",
                "summary": "description",
                "location": "location",
                "detected_extensions": "detected_extensions", // 保留原始字段以便后续处理
                "related_links": "related_links"
            }
        },
        collection_endpoint_key: "query",
        // ⚠️ SerpApi 的 'date_posted' 参数接受 'past_24h', 'past_week', 'past_month' 等字符串。
        // DataConnector 的通用时间过滤逻辑无法直接生成这些值。
        // 因此，time_filter_param_name 设为 null，需要在 dp_fetchAndQueueTasks 中手动根据 default_lookback_days 转换并添加到 'q' 参数中。
        time_filter_param_name: null,
        default_lookback_days: 30 // 逻辑上回溯30天
      },
      {
        source_id: "ARXIV_API",
        display_name: "arXiv 学术论文 API",
        source_type: "academic_paper_source",
        base_url: "http://export.arxiv.org",
        endpoint_paths: { "query": "/api/query" },
        request_method: "GET",
        payload_type: "none",
        response_type: "xml",
        auth_method: "none",
        api_key_name: null,
        api_key_header_name: null,
        api_key_query_param_name: null,
        request_headers: { "User-Agent": "DeepdiveEngine/1.0" },
        fixed_query_params: { "sortBy": "submittedDate", "sortOrder": "descending" },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: 60,
        notes: "获取物理、数学、计算机科学等领域的预印本论文。",
        pagination_param_names: { "pageSize": "max_results", "pageNumber": "start" },
        dynamic_param_names: { "q": "search_query" },
        response_mapping_rules: { "items_path": "entry", "fields": { "url": "id", "title": "title", "summary": "summary", "authors": "author.name,join", "publication_date": "published" } },
        collection_endpoint_key: "query",
        // ⚠️ arXiv API 的日期过滤（如 `submittedDate:[YYYYMMDD TO YYYYMMDD]`）需要构建到 search_query 中。
        // DataConnector 的通用时间过滤逻辑无法直接支持这种日期范围语法。
        // 因此，time_filter_param_name 设为 null，需要在 dp_fetchAndQueueTasks 中手动构建 'q' 参数。
        time_filter_param_name: null,
        default_lookback_days: 90 // 逻辑上回溯90天
      },
      {
        source_id: "NEWSAPI_ORG",
        display_name: "NewsAPI 全球新闻",
        source_type: "news_source",
        base_url: "https://newsapi.org",
        endpoint_paths: { "everything": "/v2/everything" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "header_key",
        api_key_name: "NEWS_API_KEY", // 确保在脚本属性中配置此API Key
        api_key_header_name: "X-Api-Key",
        api_key_query_param_name: null,
        request_headers: { "User-Agent": "DeepdiveEngine/1.0" },
        fixed_query_params: { "language": "en" },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: null,
        notes: "提供全球主流媒体新闻数据。支持强大的布尔查询。",
        query_strategy: "batch",
        source_credibility_rating: { "objectivity_score": 7, "tech_focus_score": 8, "political_bias_score": 4 },
        pagination_param_names: { "pageSize": "pageSize", "pageNumber": "page" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: { "items_path": "articles", "fields": { "url": "url", "title": "title", "summary": "description", "publication_date": "publishedAt", "source_platform": "source.name", "author": "author" } },
        collection_endpoint_key: "everything",
        // ✅ 时间过滤参数：NewsAPI 支持 'from' 参数，格式为 YYYY-MM-DD
        time_filter_param_name: "from",
        default_lookback_days: 7 // 默认回溯7天
      },
      {
        source_id: "GITHUB_API",
        display_name: "GitHub API",
        source_type: "opensource_data_source",
        base_url: "https://api.github.com",
        endpoint_paths: { "search_repositories": "/search/repositories" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "header_key", // 通常通过Token认证
        api_key_name: "GITHUB_API_KEY", // 确保在脚本属性中配置此API Key
        api_key_header_name: "Authorization",
        api_key_query_param_name: null,
        request_headers: { "Accept": "application/vnd.github.v3+json" },
        fixed_query_params: { "sort": "updated", "order": "desc" },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: null,
        notes: "用于搜索GitHub上的开源项目。",
        pagination_param_names: { "pageSize": "per_page", "pageNumber": "page" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: { "items_path": "items", "fields": { "url": "html_url", "title": "full_name", "summary": "description", "language": "language", "stars": "stargazers_count", "forks": "forks_count", "last_updated": "updated_at" } },
        collection_endpoint_key: "search_repositories",
        // ✅ 时间过滤参数：GitHub 搜索 API 支持 'created:YYYY-MM-DD' 语法。
        // DataConnector 的逻辑会处理 'created' 这种特殊情况，并将其添加到 'q' 参数中。
        time_filter_param_name: "created",
        default_lookback_days: 30 // 默认回溯30天
      },
      {
        source_id: "SERPAPI_PATENTS",
        display_name: "SerpApi Google Patents",
        source_type: "patent_data_source",
        base_url: "https://serpapi.com",
        endpoint_paths: { "query": "/search.json" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "query_param_key",
        api_key_name: "SERPAPI_KEY", // 确保在脚本属性中配置此API Key
        api_key_header_name: null,
        api_key_query_param_name: "api_key",
        request_headers: null,
        fixed_query_params: { "engine": "google_patents" },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: null,
        notes: "通过专业的第三方代理SerpApi查询Google Patents数据。",
        pagination_param_names: { "pageSize": "num", "pageNumber": "start" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: { "items_path": "organic_results", "fields": { "id": "publication_number", "url": "link", "title": "title", "summary": "snippet", "authors": "inventors,join", "publication_date": "publication_date" } },
        collection_endpoint_key: "query",
        // ✅ 时间过滤参数：SerpApi Google Patents API 支持 'after_date' 参数，格式为 YYYY-MM-DD
        time_filter_param_name: "after_date",
        default_lookback_days: 365 // 默认回溯365天（一年），专利数据更新较慢
      },
      {
        source_id: "RSS_TO_JSON_API",
        display_name: "RSS to JSON Converter",
        source_type: "rss_parser_service", // 这是一个通用服务，可以用于多种数据类型
        base_url: "https://api.rss2json.com",
        endpoint_paths: { "parse": "/v1/api.json" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "query_param_key",
        api_key_name: "RSS2JSON_API_KEY", // 确保在脚本属性中配置此API Key
        api_key_query_param_name: "api_key",
        request_headers: null,
        fixed_query_params: { "order_by": "pubDate", "order_dir": "desc", "count": 10 },
        is_active: true,
        priority: 100,
        rate_limit_per_minute: 60,
        notes: "一个通用的RSS-to-JSON转换服务，用于将各种RSS/Atom Feed转换为JSON格式。",
        pagination_param_names: null, // RSS通常不直接支持分页参数，由RSS源自身控制
        dynamic_param_names: { "rss_url": "url" }, // 这里的 'url' 是 RSS Feed 的 URL
        response_mapping_rules: {
            "items_path": "items",
            "fields": { "url": "link", "title": "title", "summary": "description", "authors": "author", "publication_date": "pubDate" }
        },
        collection_endpoint_key: "parse",
        // ⚠️ RSS Feed 本身通常没有直接的 URL 参数来过滤日期。
        // 如果需要时间过滤，可能需要：
        // 1. 寻找支持日期参数的特定 RSS 源。
        // 2. 在 DataProcessService.dp_processSingleTask 中，根据 publication_date 字段进行后置过滤。
        time_filter_param_name: null,
        default_lookback_days: null // 无直接作用，表示不通过此机制过滤
      },
      {
        "source_id": "OPENAI_API",
        "display_name": "OpenAI LLM 服务",
        "source_type": "llm_service", // 这是一个LLM服务，不作为常规数据采集源
        "base_url": "https://api.openai.com",
        "endpoint_paths": {
          "chat_completions": "/v1/chat/completions",
          "embeddings": "/v1/embeddings"
        },
        "request_method": "POST",
        "payload_type": "json",
        "response_type": "json",
        "auth_method": "bearer_token",
        "api_key_name": "OPENAI_API_KEY", // 确保在脚本属性中配置此API Key
        "api_key_header_name": "Authorization",
        "api_key_query_param_name": null,
        "request_headers": null,
        "fixed_query_params": null,
        "is_active": true,
        "priority": 100,
        "rate_limit_per_minute": 60,
        "notes": "用于文本生成、评分和向量嵌入。",
        "pagination_param_names": null,
        "dynamic_param_names": null,
        "response_mapping_rules": null,
        "http_method_override": {
          "embeddings": "POST" // 明确指定 embeddings 使用 POST 方法
        },
        "collection_endpoint_key": null, // LLM 服务通常不作为数据采集源，所以没有此键
        "default_chat_model": "gpt-4o-mini",
        "default_embedding_model": "text-embedding-3-small"
      }
    ];

    const now = new Date();
    // 遍历所有配置，为新添加或更新的配置设置时间戳
    dataSourceConfigs.forEach(config => {
        // 如果配置中没有 created_timestamp，则设置为当前时间
        config.created_timestamp = config.created_timestamp || now;
        // 每次运行此函数，都更新 last_updated_timestamp
        config.last_updated_timestamp = now;
    });

    // 获取当前 Firestore 中的所有数据源配置，用于比较和更新
    const existingConfigs = DataService.getDataAsObjects('REG_SOURCES') || [];
    const existingConfigMap = new Map(existingConfigs.map(c => [c.source_id, c]));

    const configsToUpsert = [];

    // 遍历预设配置，如果不存在或与现有配置不同，则添加到 upsert 列表
    for (const config of dataSourceConfigs) {
      const existing = existingConfigMap.get(config.source_id);
      // 简单比较：如果不存在，或者现有配置的JSON字符串与新配置不同，则视为需要更新
      // 注意：JSON.stringify 比较可能对属性顺序敏感，但对于此用途通常足够
      if (!existing || JSON.stringify(existing) !== JSON.stringify(config)) {
        configsToUpsert.push(config);
      }
    }

    Logger.log(`[DEBUG] configsToUpsert.length: ${configsToUpsert.length}`);
    if (configsToUpsert.length > 0) {
      Logger.log(`发现 ${configsToUpsert.length} 条需要更新/新增的外部数据源配置。`);
      Logger.log(`[DEBUG] configsToUpsert 内容: ${JSON.stringify(configsToUpsert, null, 2)}`);
      // 批量更新/插入到 Firestore 的 EXTERNAL_DATA_SOURCES 集合
      const count = DataService.batchUpsert('REG_SOURCES', configsToUpsert, 'source_id');
      Logger.log(`✅ 成功刷新/写入了 ${count} 条数据源配置到数据库中。`);
    } else {
      Logger.log("没有外部数据源配置需要更新。");
    }

  } catch (e) {
    Logger.log(`❌ 刷新外部数据源时发生严重错误: ${e.message}\n${e.stack}`);
    throw e; // 重新抛出错误，让调用者知道失败
  }
  Logger.log("--- 外部数据源配置填充/刷新完成 ---");
}

function seedInitialRoles() {
  const jobName = 'SeedInitialRoles';
  Logger.log(`--- [${jobName}] 开始初始化角色与权限 ---`);

  const roles = [
    {
      role_id: 'admin',
      role_name: 'System Administrator',
      description: '拥有系统所有权限的超级管理员。',
      // 确保这里包含所有服务名称的小写形式
      allowed_modules: [
        'dashboard', // DashboardService
        'exploration', // ExplorationService
        'analysis', // AnalysisService
        'findings', // FindingsService
        'copilot', // CopilotService
        'registry', // RegistryService
        'systemhealthstats' // SystemHealthStatsService
        // 如果有其他服务，也需要添加
      ],
      can_override_focus: true,
      default_tech_focus_ids: [],
      default_competitor_focus_ids: []
    },
    {
      role_id: 'analyst',
      role_name: 'Analyst',
      description: '核心分析师，拥有大部分功能权限。',
      allowed_modules: ['dashboard', 'exploration', 'analysis', 'findings', 'copilot'],
      can_override_focus: true,
      default_tech_focus_ids: [],
      default_competitor_focus_ids: []
    },
    {
      role_id: 'guest',
      role_name: 'Guest',
      description: '访客或只读用户，权限受限。',
      allowed_modules: ['dashboard'],
      can_override_focus: false,
      default_tech_focus_ids: ['tech_large_language_models', 'tech_generative_ai'], 
      default_competitor_focus_ids: ['comp_openai', 'comp_google']
    }
  ];

  try {
    DataService.batchUpsert('REG_ROLES', roles, 'role_id');
    Logger.log(`[${jobName}] 成功初始化 ${roles.length} 个角色: ${roles.map(r => r.role_id).join(', ')}。`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
  }
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}


function BATCH_IMPORT_SOURCE_CONFIGS_FINAL() {
  const JSON_CONFIG = `
  [
    {
      "source_id": "OPENAI_API", "display_name": "OpenAI LLM 服务", "is_active": true,
      "source_type": ["llm_service"], "base_url": "https://api.openai.com",
      "endpoint_paths": {"chat_completions": "/v1/chat/completions", "embeddings": "/v1/embeddings"},
      "request_method": "POST", "response_type": "json", "auth_method": "bearer_token",
      "api_key_name": "OPENAI_API_KEY", "priority": 100
    },
    {
      "source_id": "ARXIV_API", "display_name": "arXiv 学术论文 API", "is_active": true,
      "source_type": ["academic_paper_source"], "base_url": "http://export.arxiv.org",
      "endpoint_paths": {"query": "/api/query"}, "collection_endpoint_key": "query",
      "request_method": "GET", "response_type": "xml",
      "fixed_query_params": {"sortBy": "submittedDate", "sortOrder": "descending"},
      "dynamic_param_names": {"search_query": "all:{QUERY}"},
      "time_filter_param_name": "search_query",
      "time_filter_format": "ARXIV_DATE_RANGE",
      "default_lookback_days": 90,
      "response_mapping_rules": {"items_path": "entry", "fields": {"url": "id", "title": "title", "summary": "summary", "authors": "author.name,join", "publication_date": "published"}}
    },
    {
      "source_id": "GITHUB_API", "display_name": "GitHub API", "is_active": true,
      "source_type": ["opensource_data_source"], "base_url": "https://api.github.com",
      "endpoint_paths": {"search": "/search/repositories"}, "collection_endpoint_key": "search",
      "request_method": "GET", "response_type": "json",
      "auth_method": "header_key", "api_key_name": "GITHUB_API_KEY", "api_key_header_name": "Authorization",
      "fixed_query_params": {"sort": "updated", "order": "desc"},
      "dynamic_param_names": {"q": "{QUERY}"},
      "time_filter_param_name": "q",
      "time_filter_format": "GITHUB_CREATED_DATE",
      "default_lookback_days": 30,
      "response_mapping_rules": {"items_path": "items", "fields": {"url": "html_url", "title": "full_name", "summary": "description", "publication_date": "updated_at"}}
    },
    {
      "source_id": "NEWSAPI_ORG", "display_name": "NewsAPI 全球新闻", "is_active": true,
      "source_type": ["news_source"], "base_url": "https://newsapi.org",
      "endpoint_paths": {"everything": "/v2/everything"}, "collection_endpoint_key": "everything",
      "request_method": "GET", "response_type": "json",
      "auth_method": "header_key", "api_key_name": "NEWS_API_KEY", "api_key_header_name": "X-Api-Key",
      "fixed_query_params": {"language": "en"},
      "dynamic_param_names": {"q": "{QUERY}"},
      "time_filter_param_name": "from",
      "time_filter_format": "ISO_DATE",
      "default_lookback_days": 7,
      "response_mapping_rules": {"items_path": "articles", "fields": {"url": "url", "title": "title", "summary": "description", "publication_date": "publishedAt", "source_platform": "source.name"}}
    },
    {
      "source_id": "HACKERNEWS_API", "display_name": "Hacker News (Algolia Search)", "is_active": true,
      "source_type": ["news_source"],
      "base_url": "http://hn.algolia.com",
      "endpoint_paths": {"search": "/api/v1/search"}, "collection_endpoint_key": "search",
      "request_method": "GET", "response_type": "json",
      "fixed_query_params": {"tags": "story"},
      "dynamic_param_names": {"query": "{QUERY}"},
      "time_filter_param_name": "numericFilters",
      "time_filter_value_template": "created_at_i>{TIMESTAMP}",
      "time_filter_format": "ALGOLIA_UNIX_TIMESTAMP",
      "default_lookback_days": 7,
      "response_mapping_rules": {"items_path": "hits", "fields": {"id": "objectID", "url": "url", "title": "title", "summary": "story_text", "publication_date": "created_at", "author": "author"}}
    }
  ]
  `;
  const sourceObjects = JSON.parse(JSON_CONFIG);
  Logger.log(`准备批量导入 ${sourceObjects.length} 个数据源配置...`);
  DataService.batchUpsert('REG_SOURCES', sourceObjects, 'source_id');
  Logger.log('✅ 批量导入完成！');
}



/**
 * [可执行] 初始化系统的角色与权限。
 * 这是在新系统部署后，应该第一个执行的 seeding 任务。
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
function seedInitialRoles() {
  const jobName = 'SeedInitialRoles';
  Logger.log(`--- [${jobName}] 开始初始化角色与权限 ---`);

  const roles = [
    {
      role_id: 'admin',
      role_name: 'System Administrator',
      description: '拥有系统所有权限的超级管理员。',
      // 'registry' 是我们新的合并后的管理模块名
      allowed_modules: ['dashboard', 'exploration', 'analysis', 'findings', 'copilot', 'registry', 'systemhealthstats'],
      can_override_focus: true,
      default_tech_focus_ids: [],
      default_competitor_focus_ids: []
    },
    {
      role_id: 'analyst',
      role_name: 'Analyst',
      description: '核心分析师，拥有大部分功能权限。',
      allowed_modules: ['dashboard', 'exploration', 'analysis', 'findings', 'copilot'],
      can_override_focus: true,
      default_tech_focus_ids: [],
      default_competitor_focus_ids: []
    },
    {
      role_id: 'guest',
      role_name: 'Guest',
      description: '访客或只读用户，权限受限。',
      allowed_modules: ['dashboard'],
      can_override_focus: false,
      // 示例：访客默认关注的领域
      default_tech_focus_ids: ['tech_large_language_models', 'tech_generative_ai'], 
      default_competitor_focus_ids: ['comp_openai', 'comp_google']
    }
  ];

  try {
    // 使用我们最终的CONFIG键名写入
    DataService.batchUpsert('REG_ROLES', roles, 'role_id');
    Logger.log(`[${jobName}] 成功初始化 ${roles.length} 个角色: ${roles.map(r => r.role_id).join(', ')}。`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
  }
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}


//==================================================================
//  Seeding Task 2: 创建初始管理员用户
//==================================================================

/**
 * [可执行] 创建一个初始的管理员用户。
 * 在初始化角色后运行此函数，为自己赋予管理员权限。
 * 
 * !! 重要 !! 在运行前，请务必修改下面的 'YOUR_ADMIN_EMAIL@example.com'。
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
function createInitialAdminUser() {
  // ▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼▼
  //                 请将此处的邮箱地址替换为您自己的Google账号
  const ADMIN_EMAIL = 'hello.duanjunjie@gmail.com';
  // ▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲▲
  
  const jobName = 'CreateInitialAdminUser';
  
  if (ADMIN_EMAIL === 'YOUR_ADMIN_EMAIL@example.com') {
    Logger.log(`[${jobName}] 请先在代码中修改 ADMIN_EMAIL 变量的值！`);
    Browser.msgBox("操作中止", "请先在 tools.seeding.js 文件中修改 ADMIN_EMAIL 变量为您自己的邮箱地址。", Browser.Buttons.OK);
    return;
  }
  
  Logger.log(`--- [${jobName}] 正在为 ${ADMIN_EMAIL} 创建管理员账户 ---`);
  
  const adminUser = {
    user_email: ADMIN_EMAIL, // 使用user_email作为文档ID
    display_name: 'Admin',
    role_id: 'admin',
    status: 'active',
    created_timestamp: new Date(),
    updated_timestamp: new Date()
  };

  try {
    // 使用我们最终的CONFIG键名写入
    DataService.batchUpsert('REG_USERS', [adminUser], 'user_email');
    Logger.log(`[${jobName}] 成功为 ${ADMIN_EMAIL} 创建管理员账户。`);
  } catch(e) {
    Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
  }
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}


//==================================================================
//  Seeding Task 3: 填充初始监控实体（示例）
//==================================================================

/**
 * [可执行] 在 'registry_entities' 集合中填充一批初始的、需要监控的实体。
 * 这可以帮助您快速启动系统的数据采集。
 * 
 * 运行方式：在Apps Script编辑器中，选择此函数并点击“运行”。
 */
function seedInitialEntities() {
  const jobName = 'SeedInitialEntities';
  Logger.log(`--- [${jobName}] 开始填充初始监控实体 ---`);

  const initialEntities = [
    // 公司实体
    { entity_id: 'comp_nvidia', primary_name: 'NVIDIA', entity_type: 'Company', aliases: ['NVDA'], stock_symbol: 'NVDA', monitoring_status: 'active' },
    { entity_id: 'comp_google', primary_name: 'Google', entity_type: 'Company', aliases: ['Alphabet'], stock_symbol: 'GOOGL', monitoring_status: 'active' },
    { entity_id: 'comp_openai', primary_name: 'OpenAI', entity_type: 'Company', aliases: [], stock_symbol: null, monitoring_status: 'active' },
    
    // 技术实体
    { entity_id: 'tech_large_language_models', primary_name: 'Large Language Models', entity_type: 'Technology', aliases: ['LLM'], tech_keywords: 'LLM,Large Language Model,GPT,Transformer', monitoring_status: 'active' },
    { entity_id: 'tech_generative_ai', primary_name: 'Generative AI', entity_type: 'Technology', aliases: ['AIGC'], tech_keywords: 'Generative AI,AIGC,Text-to-Image,Diffusion Model', monitoring_status: 'active' }
  ];

  // 为每个实体添加时间戳
  const entitiesWithTimestamp = initialEntities.map(e => ({
    ...e,
    created_timestamp: new Date(),
    updated_timestamp: new Date()
  }));

  try {
    DataService.batchUpsert('REG_ENTITIES', entitiesWithTimestamp, 'entity_id');
    Logger.log(`[${jobName}] 成功填充 ${entitiesWithTimestamp.length} 个初始实体。`);
  } catch (e) {
    Logger.log(`[${jobName}] FATAL ERROR: ${e.message}\n${e.stack}`);
  }
  Logger.log(`--- [${jobName}] 任务结束 ---`);
}