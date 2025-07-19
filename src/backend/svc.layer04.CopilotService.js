/**
 * @file layer04.CopilotService.js
 * @description [API服务层] AI助手后台服务。
 * 负责处理复杂的自然语言查询，并协同其他服务进行深度研究。
 */

const CopilotService = {

  // 简单的任务状态存储 (仅用于模拟异步，实际生产环境应使用 Firestore 或其他持久化存储)
  _researchJobStatus: {},

  /**
   * [API] 执行一次深度研究。
   * 匹配 mock_api.js -> CopilotService.performDeepResearch
   * @param {string} query - 用户的自然语言查询。
   * @returns {object} { jobId: string }
   */
  performDeepResearch: async function(query) {
    if (!query || query.trim().length < 5) {
      throw new Error("请输入更具体的研究问题。");
    }
    
    const jobId = `copilot-job-${Utilities.getUuid()}`;
    // 初始化任务状态
    this._researchJobStatus[jobId] = {
      status: 'PENDING',
      progress: 0,
      result: null,
      error: null,
      startTime: new Date(),
      query: query
    };

    // 模拟异步执行，实际这里会触发一个后台进程或Apps Script可安装触发器
    // 为了Apps Script的单次执行限制，这里不能真正“等待”很长时间
    // 实际应将耗时操作拆分到由可安装触发器调用的独立函数中
    // 这里暂时用 setTimeout 模拟，但它不会跨 Apps Script 进程持续执行
    // 真正的实现需要结合 Apps Script 的可安装触发器 (time-driven triggers)
    // 或者 Google Cloud Functions 来处理长时间运行的任务。

    // 暂时先直接执行，这样在一次请求中就能完成，方便本地测试
    // 真实的异步，需要将这个逻辑放到一个由触发器调用的独立函数中
    // 并在该函数中更新 this._researchJobStatus[jobId] 的状态
    
    // 立即启动一个模拟的后台处理
    this._simulateAsyncResearch(jobId, query);

    return { jobId: jobId };
  },

  /**
   * [PRIVATE] 模拟异步研究过程。
   * 实际应由Apps Script的可安装触发器或其他Google Cloud服务实现。
   */
  _simulateAsyncResearch: async function(jobId, query) {
    const job = this._researchJobStatus[jobId];
    if (!job) return;

    try {
      job.status = 'IN_PROGRESS';
      job.progress = 10;

      // 1. 收集内部数据上下文
      const internalDataContext = await this._collectInternalDataContext(query);
      job.progress = 30;

      // 2. 构建 Prompt
      const prompt = `你是一名资深的技术与商业研究分析师。你的任务是根据提供的内部数据和用户查询，生成一份结构化、深入的分析报告。
      
      要求：
      - 报告必须是Markdown格式。
      - 报告内容应包含摘要、背景分析、关键发现、趋势预测和结论。
      - 报告应充分利用提供的内部数据和你的专业知识。
      
      内部数据上下文:
      ${internalDataContext.text}

      用户研究查询: "${query}"`;
      job.progress = 50;

      // 3. 调用 AI 生成报告
      const aiGeneratedMarkdown = await DataConnector.getBatchCompletions(prompt, {});
      job.progress = 80;

      // 4. 添加参考资料
      let finalReportMarkdown = aiGeneratedMarkdown.text || aiGeneratedMarkdown;
      if (internalDataContext.references.length > 0) {
        finalReportMarkdown += "\n\n## **参考资料 (References)**\n";
        internalDataContext.references.forEach(ref => {
          finalReportMarkdown += `- [${ref.title}](${ref.url}) - ${ref.type}, ${DateUtils.formatDate(ref.date)}\n`;
        });
      }
      job.result = finalReportMarkdown;
      job.status = 'COMPLETED';
      job.progress = 100;

    } catch (e) {
      job.status = 'FAILED';
      job.error = `研究执行失败: ${e.message}`;
      Logger.log(`[CopilotService._simulateAsyncResearch] ERROR for jobId ${jobId}: ${e.message}\n${e.stack}`);
    }
  },

  /**
   * [API] 获取深度研究任务的状态。
   * 匹配 mock_api.js -> CopilotService.getResearchStatus
   * @param {string} jobId - 任务ID。
   * @returns {object} { status: string, progress: number, result: string|null, error: string|null }
   */
  getResearchStatus: function(jobId) {
    const job = this._researchJobStatus[jobId];
    if (!job) {
      return { status: 'FAILED', progress: 0, result: null, error: '任务ID不存在或已过期。' };
    }
    // 返回一个副本，避免外部直接修改内部状态
    return { ...job };
  },

  /**
   * [PRIVATE] 收集与查询相关的内部数据作为AI的上下文。
   */
  _collectInternalDataContext: async function(query) {
    let internalDataText = "";
    const collectedReferences = [];
    const maxItemsPerCollection = 3;
    const queryLower = query.toLowerCase();
    
    const collectionsToSearch = [
      { key: 'FND_MASTER', fields: ['title', 'ai_summary', 'ai_keywords'], label: '核心发现' },
      { key: 'EVD_NEWS', fields: ['title', 'summary'], label: '相关新闻' },
      { key: 'EVD_PAPERS', fields: ['title', 'summary'], label: '相关论文' },
    ];

    for (const colConfig of collectionsToSearch) {
      const allItems = DataService.getDataAsObjects(colConfig.key, {limit: 100}) || [];
      const relevantItems = allItems.filter(item => {
        const content = colConfig.fields.map(field => item[field] || '').join(' ').toLowerCase();
        return content.includes(queryLower);
      }).slice(0, maxItemsPerCollection);

      if (relevantItems.length > 0) {
        internalDataText += `\n### **相关${colConfig.label}:**\n`;
        relevantItems.forEach(item => {
          const title = item.title || '无标题';
          const summary = item.ai_summary || item.summary || '无摘要';
          const date = item.publication_timestamp ? DateUtils.formatDate(item.publication_timestamp) : DateUtils.formatDate(item.created_timestamp);
          const sourceUrl = item.url || '#';
          internalDataText += `- **${title}** (日期: ${date}): ${summary.substring(0, Math.min(summary.length, 150))}...\n`;
          collectedReferences.push({ title, url: sourceUrl, date, type: colConfig.label });
        });
      }
    }
    return { text: internalDataText || "未找到直接相关的内部数据。", references: collectedReferences };
  },

  /**
   * [PRIVATE] 将AI返回的Markdown转换为安全的HTML。
   */
  _convertMarkdownToSafeHtml: function(mdText) {
    let html = mdText.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    html = html.replace(/^##\s*(.*)$/gm, '<h2>$1</h2>');
    html = html.replace(/^###\s*(.*)$/gm, '<h3>$1</h3>');
    html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
    html = html.replace(/^- (.*)$/gm, '<li>$1</li>');
    html = html.replace(/((?:<li>.*<\/li>\s*)+)/gs, '<ul>$1</ul>');
    html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank">$1</a>');
    html = html.replace(/\n/g, '<br>');
    return html;
  }
};
