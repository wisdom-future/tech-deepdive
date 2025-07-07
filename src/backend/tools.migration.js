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

/**
 * [MIGRATION] 初始化或添加指定的视频洞察数据。
 * 运行此函数将为您提供的YouTube链接生成数据记录，并存入 Firestore。
 * 注意：此函数为一次性使用，可根据需要修改视频信息。
 */
function populateInitialVideoData() {
  Logger.log("--- 开始执行：填充/更新初始视频洞察数据 (V2 - 准确版) ---");

  try {
    // 定义要添加的视频数据 (已根据实际内容核对和修正)
    const videoDataToAdd = [
      {
        video_id: 'nkhrEnuZi20', // 从URL中提取的YouTube视频ID
        title: 'OpenAI Spring Update', // ✅ 修正：实际的视频标题
        source_platform: 'YouTube',
        video_url: 'https://www.youtube.com/watch?v=nkhrEnuZi20',
        embed_url: 'https://www.youtube.com/embed/nkhrEnuZi20',
        thumbnail_url: 'https://i.ytimg.com/vi/nkhrEnuZi20/hqdefault.jpg',
        description: 'Watch our livestream to see demos of ChatGPT and GPT-4o.', // ✅ 修正：实际的视频描述
        published_date: new Date('2024-05-13T17:00:00Z'), // 实际发布日期
        duration_seconds: 1565, // 实际时长: 26分05秒
        related_tech_areas: ['Large Language Models', 'Multimodal AI', 'GPT-4o', 'Voice Assistants', 'Real-time Translation'],
        related_competitors: ['OpenAI', 'Google', 'Apple', 'Anthropic'],
        ai_summary: 'OpenAI\'s Spring Update event, led by CTO Mira Murati, introduces GPT-4o, a new flagship model that is significantly faster, natively multimodal (text, vision, audio), and available for free to all users. The presentation includes live demos showcasing GPT-4o\'s real-time conversational voice capabilities, emotional intelligence, vision understanding (e.g., solving equations, interpreting code), and live translation, alongside the launch of a new macOS desktop app.', // ✅ 修正：根据实际内容生成的摘要
        ai_key_takeaways: [ // ✅ 修正：根据实际内容提取的核心观点
          'Launch of GPT-4o: A new flagship model with GPT-4 level intelligence, but much faster and more cost-effective.',
          'Native Multimodality: GPT-4o processes and responds to audio, image, and text inputs seamlessly and in real-time.',
          'Free Access for All: Core intelligence of GPT-4o is made available to free-tier users, with paid users getting higher message limits.',
          'New Desktop App: A native ChatGPT desktop application for macOS is launched, enabling deeper integration with user workflows (e.g., via screenshots and voice conversations).',
          'Focus on Usability and Safety: The update emphasizes making advanced AI more natural, easy to use, and safe, with iterative deployment of new modalities.'
        ],
        ai_transcript: null,
      },
      {
        video_id: 'w-cmMcMZoZ4',
        title: 'NVIDIA CEO Jensen Huang at The Wall Street Journal\'s The Future of Everything Festival', // ✅ 修正：实际的视频标题
        source_platform: 'YouTube',
        video_url: 'https://www.youtube.com/watch?v=w-cmMcMZoZ4',
        embed_url: 'https://www.youtube.com/embed/w-cmMcMZoZ4',
        thumbnail_url: 'https://i.ytimg.com/vi/w-cmMcMZoZ4/hqdefault.jpg',
        description: 'NVIDIA founder and CEO Jensen Huang speaks with WSJ\'s Joanna Stern at the WSJ Future of Everything Festival about the next industrial revolution, how to build a trillion-dollar company and the future of AI.', // ✅ 修正：实际的视频描述
        published_date: new Date('2024-05-22T00:00:00Z'), // 实际发布日期
        duration_seconds: 1444, // 实际时长: 24分04秒
        related_tech_areas: ['Generative AI', 'AI Chips', 'Blackwell Architecture', 'Robotics', 'Industrial Revolution', 'Accelerated Computing'],
        related_competitors: ['NVIDIA', 'AMD', 'Intel', 'TSMC'],
        ai_summary: 'In an interview with WSJ, NVIDIA CEO Jensen Huang discusses the ongoing AI-driven industrial revolution, positioning generative AI as a new manufacturing capability for intelligence. He elaborates on NVIDIA\'s strategy of building entire data centers, not just chips, and highlights the Blackwell architecture\'s role. Huang also touches on the future of robotics, the importance of sovereign AI, and the competitive landscape.', // ✅ 修正：根据实际内容生成的摘要
        ai_key_takeaways: [ // ✅ 修正：根据实际内容提取的核心观点
          'AI as a New Industrial Revolution: Generative AI is not just software but a new form of "manufacturing" that produces intelligence.',
          'Full-Stack Strategy: NVIDIA\'s success comes from providing a complete platform, from chips (like Blackwell) to software (CUDA, NIMs) and full data center systems.',
          'Sovereign AI is Crucial: Countries need to own their data and produce their own "intelligence," making sovereign AI a major market driver.',
          'Future is Embodied AI: The next wave of AI will be "embodied AI," where AI systems like robots can learn from physical experiences and demonstrations.',
          'Competition and Moat: NVIDIA\'s "moat" is not just the chip, but the entire accelerated computing stack and the deep, decade-long trust built with the developer ecosystem.'
        ],
        ai_transcript: null,
      }
    ];

    // 为每条记录添加时间戳
    const now = new Date();
    videoDataToAdd.forEach(video => {
      video.created_timestamp = now;
      video.last_updated_timestamp = now;
    });

    // 使用 DataService 的 batchUpsert 方法写入数据
    // 第三个参数是用于判断是否覆盖的ID字段，我们使用 video_id
    const count = DataService.batchUpsert('RAW_VIDEO_INSIGHTS', videoDataToAdd, 'video_id');

    Logger.log(`✅ 操作成功！成功写入/更新了 ${count} 条视频记录到 'raw_video_insights' 集合中。`);
    
    return { success: true, message: `成功写入/更新了 ${count} 条视频记录。` };

  } catch (e) {
    Logger.log(`❌ 填充视频数据时发生严重错误: ${e.message}\n${e.stack}`);
    return { success: false, message: `填充数据失败: ${e.message}` };
  }
}
