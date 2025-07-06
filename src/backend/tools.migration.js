// 文件名: backend/tools.migration.gs

/**
 * @fileoverview 包含一次性的数据迁移和初始化脚本。
 * 这些函数不应被前端调用，仅供开发者在Apps Script编辑器中手动运行。
 */

/**
 * [MIGRATION] 初始化或重置 external_data_sources 集合。
 * 运行此函数将使用下面定义的最新、最完整的配置来覆盖 Firestore 中的数据。
 * ✅ V5版：修正并使用 dynamic_param_names 实现完全的参数自适应。
 */
function populateInitialDataSourceConfigs() {
  Logger.log("=========================================================");
  Logger.log("--- 开始执行：填充/刷新外部数据源配置 (V5 - 完全自适应版) ---");
  Logger.log("=========================================================");

  try {
    const dataSourceConfigs = [
      { // ----- 1. arXiv API -----
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
        request_headers: { "User-Agent": "DeepdiveEngine/1.0" },
        fixed_query_params: { "sortBy": "submittedDate", "sortOrder": "descending" },
        is_active: true,
        priority: 100,
        notes: "获取物理、数学、计算机科学等领域的预印本论文。",
        pagination_param_names: { "pageSize": "max_results", "pageNumber": "start" },
        dynamic_param_names: { "q": "search_query" },
        response_mapping_rules: {
          "items_path": "entry",
          "fields": { "url": "id", "title": "title", "summary": "summary", "authors": "author.name,join", "publication_date": "published" }
        }
      },
      { // ----- 2. NewsAPI -----
        source_id: "NEWSAPI_ORG",
        display_name: "NewsAPI 全球新闻",
        source_type: "news_source",
        base_url: "https://newsapi.org",
        endpoint_paths: { "everything": "/v2/everything" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "header_key",
        api_key_name: "NEWS_API_KEY",
        api_key_header_name: "X-Api-Key",
        request_headers: { "User-Agent": "DeepdiveEngine/1.0" },
        fixed_query_params: { "language": "en" },
        is_active: true,
        priority: 100,
        notes: "提供全球主流媒体新闻数据。",
        pagination_param_names: { "pageSize": "pageSize", "pageNumber": "page" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: {
          "items_path": "articles",
          "fields": { "url": "url", "title": "title", "summary": "description", "publication_date": "publishedAt", "source_platform": "source.name", "author": "author" }
        }
      },
      { // ----- 3. Hacker News API -----
        source_id: "HACKERNEWS_API",
        display_name: "Hacker News (Algolia Search)",
        source_type: "news_source",
        base_url: "http://hn.algolia.com",
        endpoint_paths: { "everything": "/api/v1/search" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "none",
        api_key_name: null,
        request_headers: null,
        fixed_query_params: { "tags": "story" },
        is_active: true,
        priority: 90,
        notes: "通过Algolia提供的Hacker News搜索API，获取高质量技术社区讨论。",
        pagination_param_names: { "pageSize": "hitsPerPage", "pageNumber": "page" },
        dynamic_param_names: { "q": "query" }, // ✅ 修正：通用查询'q'映射到此API的'query'
        response_mapping_rules: {
          "items_path": "hits",
          "fields": { "url": "url", "title": "title", "summary": "story_text", "publication_date": "created_at", "source_platform": "author", "author": "author" }
        }
      },
      { // ----- 4. OpenAI API -----
        source_id: "OPENAI_API",
        display_name: "OpenAI LLM 服务",
        source_type: "llm_service",
        base_url: "https://api.openai.com",
        endpoint_paths: { "chat_completions": "/v1/chat/completions", "embeddings": "/v1/embeddings" },
        request_method: "POST",
        payload_type: "json",
        response_type: "json",
        auth_method: "bearer_token",
        api_key_name: "OPENAI_API_KEY",
        api_key_header_name: "Authorization",
        is_active: true,
        priority: 100,
        notes: "用于文本生成、评分和向量嵌入。",
        pagination_param_names: null,
        dynamic_param_names: null,
        response_mapping_rules: null
      },
      { // ----- 5. GitHub API -----
        source_id: "GITHUB_API",
        display_name: "GitHub API",
        source_type: "opensource_data_source",
        base_url: "https://api.github.com",
        endpoint_paths: { "search_repositories": "/search/repositories" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "bearer_token",
        api_key_name: "GITHUB_API_KEY",
        api_key_header_name: "Authorization",
        request_headers: { "Accept": "application/vnd.github.v3+json" },
        fixed_query_params: { "sort": "updated", "order": "desc" },
        is_active: true,
        priority: 100,
        notes: "用于搜索GitHub上的开源项目。",
        pagination_param_names: { "pageSize": "per_page", "pageNumber": "page" },
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: {
          "items_path": "items",
          "fields": { "url": "html_url", "title": "full_name", "summary": "description", "language": "language", "stars": "stargazers_count", "forks": "forks_count", "last_updated": "updated_at" }
        }
      },
      { // ----- 7. SerpApi Google Patents (稳定、可靠的最终方案) -----
        source_id: "SERPAPI_PATENTS",
        display_name: "SerpApi Google Patents",
        source_type: "patent_data_source",
        base_url: "https://serpapi.com",
        endpoint_paths: { "query": "/search.json" },
        request_method: "GET",
        payload_type: "none",
        response_type: "json",
        auth_method: "query_param_key", // ✅ 它的认证方式是URL参数
        api_key_name: "SERPAPI_KEY",      // ✅ 使用我们新配置的Key
        api_key_query_param_name: "api_key", // ✅ 参数名叫 api_key
        request_headers: null,
        fixed_query_params: { "engine": "google_patents" }, // ✅ 固定参数：告诉SerpApi我们要用Google Patents引擎
        is_active: true,
        priority: 100,
        notes: "通过专业的第三方代理SerpApi查询Google Patents数据。",
        pagination_param_names: { "pageSize": "num", "pageNumber": "start" }, // SerpApi用start来翻页
        dynamic_param_names: { "q": "q" },
        response_mapping_rules: {
          "items_path": "organic_results", // ✅ 它的结果在 organic_results 数组里
          "fields": {
            "id": "publication_number",
            "url": "link",
            "title": "title",
            "summary": "snippet",
            "authors": "inventors,join",
            "publication_date": "publication_date"
          }
        }
      }
    ];

    // 为所有配置添加时间戳
    dataSourceConfigs.forEach(config => {
        config.created_timestamp = new Date();
        config.last_updated_timestamp = new Date();
    });

    const collectionKey = 'EXTERNAL_DATA_SOURCES';
    const idField = 'source_id';
    
    Logger.log(`准备使用最新的定义刷新 ${dataSourceConfigs.length} 条数据源配置...`);
    
    // 直接使用 batchUpsert 会覆盖已存在的同名文档，达到刷新效果
    const count = DataService.batchUpsert(collectionKey, dataSourceConfigs, idField);

    Logger.log(`✅ 成功刷新/写入了 ${count} 条数据源配置。`);
    Logger.log("\n🎉🎉🎉 外部数据源配置刷新成功！🎉🎉🎉");

  } catch (e) {
    Logger.log(`❌ 刷新外部数据源时发生严重错误: ${e.message}\n${e.stack}`);
  } finally {
    Logger.log("=========================================================");
    Logger.log("--- 脚本执行结束 ---");
    Logger.log("=========================================================");
  }
}
