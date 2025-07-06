// 文件名: backend/svc.DeepResearch.gs

/**
 * @file AI驱动的深度研究服务
 * 负责接收用户查询，并调用AI模型进行深度分析，返回结构化研究报告。
 * 增强版：结合内部数据库信息进行深度研究。
 */

const DeepResearchService = {

  _collectAndFilterInternalData: function(query) {
    Logger.log(`[DeepResearchService] 开始收集内部数据，查询: ${query}`);
    let internalDataText = "";
    const maxItemsPerCollection = 3; // ✅ 减少每个集合最多获取的条目数，让AI更聚焦
    const queryLower = query.toLowerCase();

    const collectionsToSearch = [
      { key: 'TECH_INSIGHTS_MASTER', fields: ['title', 'content_summary', 'tech_keywords'], label: '高价值洞察' },
      { key: 'RAW_TECH_NEWS', fields: ['news_title', 'news_summary', 'ai_summary', 'ai_keywords'], label: '技术新闻' },
      { key: 'RAW_ACADEMIC_PAPERS', fields: ['title', 'abstract', 'ai_summary', 'ai_keywords'], label: '学术论文' },
      { key: 'RAW_PATENT_DATA', fields: ['title', 'abstract', 'ai_summary', 'ai_keywords'], label: '专利数据' },
      { key: 'RAW_OPENSOURCE_DATA', fields: ['project_name', 'description', 'ai_summary', 'ai_keywords'], label: '开源项目' },
      { key: 'RAW_INDUSTRY_DYNAMICS', fields: ['event_title', 'event_summary', 'ai_summary', 'ai_keywords'], label: '产业动态' },
      { key: 'RAW_COMPETITOR_INTELLIGENCE', fields: ['intelligence_title', 'intelligence_summary', 'ai_summary', 'ai_keywords'], label: '竞争情报' }
    ];

    collectionsToSearch.forEach(colConfig => {
      try {
        const allItems = DataService.getDataAsObjects(colConfig.key) || [];
        const relevantItems = [];
        const queryWords = queryLower.split(/\s+/).filter(word => word.length > 1);

        allItems.forEach(item => {
          let itemContent = "";
          colConfig.fields.forEach(field => {
            if (item[field]) {
              itemContent += String(item[field]).toLowerCase() + " ";
            }
          });

          // ✅ 优化匹配逻辑：只要查询的任何一个词在内容中，或者内容标题包含查询的完整短语
          const isRelevant = queryWords.some(word => itemContent.includes(word)) ||
                             itemContent.includes(queryLower); // 完整短语匹配

          if (isRelevant) {
              relevantItems.push(item);
          }
        });

        relevantItems.sort((a, b) => {
            const dateA = new Date(a.created_timestamp || a.publication_date || a.last_update_timestamp || 0);
            const dateB = new Date(b.created_timestamp || b.publication_date || b.last_update_timestamp || 0);
            if (dateA.getTime() !== dateB.getTime()) {
                return dateB.getTime() - dateA.getTime(); // 最新优先
            }
            const scoreA = a.signal_strength || a.innovation_score_ai || a.commercial_value_score_ai || 0;
            const scoreB = b.signal_strength || b.innovation_score_ai || b.commercial_value_score_ai || 0;
            return scoreB - scoreA;
        });

        if (relevantItems.length > 0) {
          internalDataText += `\n### **${colConfig.label} (精选${Math.min(relevantItems.length, maxItemsPerCollection)}条):**\n`; // ✅ 粗体标题
          relevantItems.slice(0, maxItemsPerCollection).forEach((item, index) => {
            const title = item.title || item.news_title || item.event_title || item.project_name || item.intelligence_title || '无标题';
            const summary = item.ai_summary || item.content_summary || item.abstract || item.news_summary || item.event_summary || item.intelligence_summary || '无摘要';
            const date = item.publication_date ? new Date(item.publication_date).toISOString().split('T')[0] : 'N/A';
            
            internalDataText += `- **${title}** (日期: ${date})\n`;
            internalDataText += `  摘要: ${summary.substring(0, 150)}...\n`;
          });
        }
      } catch (e) {
        Logger.log(`WARN: 收集内部数据失败 (${colConfig.key}): ${e.message}`);
      }
    });

    if (internalDataText === "") {
      internalDataText = "\n**内部数据库信息：**\n未找到与您查询高度相关的内部数据。AI将主要依赖其通用知识进行分析。\n";
    } else {
      internalDataText = "\n**内部数据库信息：**\n以下是我们内部数据库中与您查询相关的精选数据，请**优先参考这些信息**进行分析：\n" + internalDataText; // ✅ 强调优先参考
    }
    Logger.log(`[DeepResearchService] 内部数据收集完成，长度: ${internalDataText.length}`);
    return internalDataText;
  },

    performDeepResearch: function(query) {
    Logger.log(`[DeepResearchService] 开始执行深度研究，查询: ${query}`);

    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      Logger.log("ERROR: OPENAI_API_KEY 未在项目属性中配置。");
      return "AI深度研究失败：AI API Key未配置。";
    }

    const internalDataContext = this._collectAndFilterInternalData(query);

    // ✅ 关键：AI提示词工程，引导AI进行“深度研究”并使用纯文本标记
    const prompt = `你是一名资深的技术与商业研究分析师，也是一位战略咨询顾问。你的任务是根据用户提供的研究查询，结合提供的内部数据库信息（如果相关），进行深入分析并生成一份结构化的报告。
    报告内容应包括：
    1.  **摘要 (Summary):** 对研究主题的简明概述。
    2.  **关键发现 (Key Findings):** 3-5个最重要的发现，应明确指出哪些发现是基于内部数据，哪些是基于AI的通用知识。如果某个发现或观点直接来源于你提供的“内部数据库信息”，请在该发现或观点后添加 **[内部数据]** 标记。
    3.  **趋势与影响 (Trends and Impact):** 深入分析相关技术或市场的发展趋势，以及这些趋势可能带来的潜在影响和机会。
    4.  **风险与挑战 (Risks and Challenges):** 指出潜在的风险、挑战或局限性。
    5.  **战略建议 (Strategic Recommendations):** 基于上述分析，提出1-3条具体的、可操作的战略或策略建议。

    ${internalDataContext} // ✅ 整合内部数据上下文

    请以Markdown格式输出报告，并严格遵循以下结构和格式要求：
    -   报告开头必须是：## **研究报告：[你的查询]**
    -   每个主要部分标题使用二级标题（## **标题**）格式。
    -   子项使用列表（-）。
    -   请勿在报告开头或结尾添加任何多余的空行或字符，确保报告内容以 ## 开头。
    -   所有引用内部数据的地方，请使用 **[内部数据]** 纯文本标记。

    用户研究查询: "${query}"

    请开始生成深度研究报告：`;

    Logger.log(`[DeepResearchService] 发送给AI的Prompt (前1000字符): ${prompt.substring(0, 1000)}...`);

    const payload = {
      model: "gpt-4o-mini", // 或 gpt-4o 以获得更好的遵循指令能力
      messages: [{ role: "user", content: prompt }],
      max_tokens: 3000, // 确保足够长
      temperature: 0.5 // 适中温度
    };

    const requestOptions = {
      method: "post",
      contentType: "application/json",
      headers: { "Authorization": "Bearer " + OPENAI_API_KEY },
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
      deadline: 300 // 延长超时
    };

    try {
      Logger.log("[DeepResearchService] 正在调用 OpenAI API...");
      const response = UrlFetchApp.fetch("https://api.openai.com/v1/chat/completions", requestOptions);
      const responseCode = response.getResponseCode();
      const responseText = response.getContentText();
      Logger.log(`[DeepResearchService] OpenAI API响应码: ${responseCode}`);
      Logger.log(`[DeepResearchService] OpenAI API原始响应 (前2000字符): ${responseText.substring(0, 2000)}...`);

      if (responseCode === 200) {
        const jsonResponse = JSON.parse(responseText);
        if (jsonResponse.choices && jsonResponse.choices.length > 0 && jsonResponse.choices[0].message) {
          let aiGeneratedReport = jsonResponse.choices[0].message.content.trim(); // ✅ 获取原始Markdown

          // ✅ 后端进行 Markdown 到 HTML 的转换和内部数据高亮
          // 这是一个简易的Markdown转HTML函数，Apps Script环境兼容
          const convertMarkdownToSafeHtml = (mdText) => {
              let htmlContent = mdText;

              // 1. 处理 ### 和 ## 标题
              htmlContent = htmlContent.replace(/^###\s*(.*)$/gm, '<h3>$1</h3>');
              htmlContent = htmlContent.replace(/^##\s*(.*)$/gm, '<h2>$1</h2>');
              htmlContent = htmlContent.replace(/^#\s*(.*)$/gm, '<h1>$1</h1>'); // 支持H1

              // 2. 处理列表 (-)
              // 匹配以 - 开头的行，转换为 <li>，然后将连续的 <li> 包裹在 <ul> 中
              htmlContent = htmlContent.replace(/^- (.*)$/gm, '<li>$1</li>');
              // 尝试将所有 <li> 标签包裹在 <ul> 中
              htmlContent = htmlContent.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');
              // 清理多余的空白行在列表内部
              htmlContent = htmlContent.replace(/<\/li>\s*<li>/g, '</li><li>');


              // 3. 处理段落（将连续的非标题、非列表行视为段落）
              // 先用占位符替换掉已处理的块级元素，再处理段落，最后恢复占位符
              htmlContent = htmlContent.replace(/(<h[1-3]>.*?<\/h[1-3]>|<ul.*?<\/ul>|<ol.*?<\/ol>)/gs, '@@BLOCK_PLACEHOLDER@@$1@@BLOCK_PLACEHOLDER@@');
              htmlContent = htmlContent.split('@@BLOCK_PLACEHOLDER@@').map(segment => {
                  if (segment.startsWith('<h') || segment.startsWith('<ul') || segment.startsWith('<ol')) {
                      return segment; // 已经是块级元素，跳过
                  }
                  // 将连续的非空行视为一个段落
                  return segment.split(/\n\s*\n/).map(p => {
                      p = p.trim();
                      if (p) return `<p>${p.replace(/\n/g, '<br>')}</p>`; // 将内部换行转为 <br>
                      return '';
                  }).join('');
              }).join('');

              // 4. 处理粗体 (**) 和斜体 (*)
              htmlContent = htmlContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
              htmlContent = htmlContent.replace(/\*(.*?)\*/g, '<em>$1</em>');

              // 5. 处理内部数据标记 [内部数据] 并高亮
              htmlContent = htmlContent.replace(/\[内部数据\]/g, '<span class="internal-data-highlight">[内部数据]</span>');

              // 6. 清理可能的多余空行
              htmlContent = htmlContent.replace(/<br>\s*<br>/g, '<br>'); // 合并连续换行
              htmlContent = htmlContent.replace(/<p>\s*<\/p>/g, ''); // 移除空段落

              // 最后，确保报告开头没有多余的空行或字符
              htmlContent = htmlContent.trim();
              
              return htmlContent;
          };

          const finalHtmlReport = convertMarkdownToSafeHtml(aiGeneratedReport);
          Logger.log(`[DeepResearchService] AI生成报告转换成功 (前500字符): ${finalHtmlReport.substring(0, 500)}...`);
          return finalHtmlReport; // 返回最终的HTML字符串
        } else {
          Logger.log("ERROR: AI响应格式不正确，缺少choices或message。");
          return "AI深度研究失败：AI响应格式错误。";
        }
      } else {
        Logger.log(`ERROR: AI API返回错误，状态码: ${responseCode}, 响应: ${responseText}`);
        return `AI深度研究失败：API错误 (${responseCode})。`;
      }
    } catch (e) {
      Logger.log(`CRITICAL ERROR: AI深度研究 API调用失败: ${e.message}\n${e.stack}`);
      return `AI深度研究失败：连接或解析错误 (${e.message})。`;
    }
  }
};
