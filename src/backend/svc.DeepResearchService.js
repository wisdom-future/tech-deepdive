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
    const collectedReferences = []; // ✅ 新增：用于存储结构化参考资料的数组
    const maxItemsPerCollection = 5; // 增加每个集合最多获取的条目数，提供更多上下文
    const queryLower = query.toLowerCase();

    // 增强查询词处理：去除停用词，并考虑更灵活的匹配
    const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'for', 'with', 'to', 'of', 'and', 'is', 'are', 'was', 'were', 'it', 'that', 'this', '公司', '企业', '技术', '研究', '发展', '行业', '创新', '领域', '新', '报告', '分析', '数据', '市场', '全球', '国际', 'ai', '人工智能', 'systems']); // 更多常用停用词，增加 'systems'
    const queryTerms = queryLower.split(/\s+/).filter(word => word.length > 1 && !stopWords.has(word));

    // 如果查询词太少，直接使用原始查询
    const effectiveQueryTerms = queryTerms.length > 0 ? queryTerms : [queryLower];

    const collectionsToSearch = [
      // 增加更多可能包含关键词的字段，以便更精准地筛选
      { key: 'TECH_INSIGHTS_MASTER', fields: ['title', 'content_summary', 'tech_keywords', 'value_proposition'], label: '高价值洞察' },
      { key: 'RAW_TECH_NEWS', fields: ['news_title', 'news_summary', 'ai_summary', 'ai_keywords', 'related_companies'], label: '技术新闻' },
      { key: 'RAW_ACADEMIC_PAPERS', fields: ['title', 'abstract', 'ai_summary', 'ai_keywords', 'authors'], label: '学术论文' },
      { key: 'RAW_PATENT_DATA', fields: ['title', 'abstract', 'ai_summary', 'ai_keywords', 'inventors', 'patent_number'], label: '专利数据' },
      { key: 'RAW_OPENSOURCE_DATA', fields: ['project_name', 'description', 'ai_summary', 'ai_keywords', 'main_language'], label: '开源项目' },
      { key: 'RAW_INDUSTRY_DYNAMICS', fields: ['event_title', 'event_summary', 'ai_summary', 'ai_keywords', 'industry_category', 'related_companies'], label: '产业动态' },
      { key: 'RAW_COMPETITOR_INTELLIGENCE', fields: ['intelligence_title', 'intelligence_summary', 'ai_summary', 'ai_keywords', 'competitor_name', 'intelligence_type'], label: '竞争情报' }
    ];

    collectionsToSearch.forEach(colConfig => {
      try {
        const allItems = DataService.getDataAsObjects(colConfig.key) || [];
        const relevantItems = [];
        
        allItems.forEach(item => {
          let itemContent = "";
          // 确保所有指定字段都被纳入内容进行匹配
          colConfig.fields.forEach(field => {
            const fieldValue = item[field];
            if (fieldValue) {
                if (Array.isArray(fieldValue)) { // 如果是数组（如 related_companies, ai_keywords），则拼接
                    itemContent += fieldValue.join(' ').toLowerCase() + " ";
                } else {
                    itemContent += String(fieldValue).toLowerCase() + " ";
                }
            }
          });

          // 宽松匹配：只要有效查询词的任一个在内容中出现
          const isRelevant = effectiveQueryTerms.some(term => itemContent.includes(term));

          if (isRelevant) {
              relevantItems.push(item);
          }
        });

        // 排序相关性最高的项目 (例如：最新或评分最高)
        relevantItems.sort((a, b) => {
            const dateA = new Date(a.created_timestamp || a.publication_date || a.last_update_timestamp || 0);
            const dateB = new Date(b.created_timestamp || b.publication_date || b.last_update_timestamp || 0);
            if (dateA.getTime() !== dateB.getTime()) {
                return dateB.getTime() - dateA.getTime(); // 最新优先
            }
            const scoreA = a.signal_strength || a.innovation_score_ai || a.commercial_value_score_ai || 0;
            const scoreB = b.signal_strength || b.innovation_score_ai || b.commercial_value_score_ai || 0;
            return scoreB - scoreA; // 其次评分高优先
        });

        if (relevantItems.length > 0) {
          internalDataText += `\n### **${colConfig.label} (精选${Math.min(relevantItems.length, maxItemsPerCollection)}条):**\n`;
          relevantItems.slice(0, maxItemsPerCollection).forEach((item, index) => {
            const title = item.title || item.news_title || item.event_title || item.project_name || item.intelligence_title || '无标题';
            const summary = item.ai_summary || item.content_summary || item.abstract || item.news_summary || item.event_summary || item.intelligence_summary || '无摘要';
            const date = (item.publication_date || item.created_timestamp) ? new Date(item.publication_date || item.created_timestamp).toISOString().split('T')[0] : 'N/A';
            const sourceUrl = item.source_url || '#'; // 确保有链接
            const sourceType = colConfig.label; // 数据源类型

            internalDataText += `- **[${title}](${sourceUrl})** (日期: ${date})\n`; // 标题添加链接
            internalDataText += `  摘要: ${summary.substring(0, Math.min(summary.length, 300))}...\n`; // 增加摘要长度
            
            // 更多关键信息
            if (item.tech_keywords) internalDataText += `  关键词: ${item.tech_keywords}\n`;
            if (item.related_companies && item.related_companies.length > 0) internalDataText += `  相关公司: ${item.related_companies.join(', ')}\n`;
            if (item.inventors) internalDataText += `  发明人: ${item.inventors}\n`;
            if (item.main_language) internalDataText += `  主要语言: ${item.main_language}\n`;
            if (item.industry_category) internalDataText += `  产业类别: ${item.industry_category}\n`;
            internalDataText += `\n`; // 每个条目之间加空行，提高可读性

            // ✅ 收集参考资料
            collectedReferences.push({
                title: title,
                url: sourceUrl,
                date: date,
                type: sourceType,
                source_platform: item.source_platform || 'N/A'
            });
          });
        }
      } catch (e) {
        Logger.log(`WARN: 收集内部数据失败 (${colConfig.key}): ${e.message}, Stack: ${e.stack}`);
      }
    });

    if (internalDataText.trim() === "") { // 检查是否真的没有任何内容
      internalDataText = "\n**内部数据库信息：**\n未找到与您查询高度相关的内部数据。AI将主要依赖其通用知识进行分析。\n";
    } else {
      internalDataText = "\n**内部数据库信息：**\n以下是我们内部数据库中与您查询相关的精选数据，请**优先参考这些信息**进行分析：\n" + internalDataText;
    }
    Logger.log(`[DeepResearchService] 内部数据收集完成，长度: ${internalDataText.length}，收集到 ${collectedReferences.length} 条参考资料。`);
    
    // ✅ 返回一个包含文本和参考资料的对象
    return { text: internalDataText, references: collectedReferences };
  },

  performDeepResearch: function(query) {
    Logger.log(`[DeepResearchService] 开始执行深度研究，查询: ${query}`);

    const OPENAI_API_KEY = PropertiesService.getScriptProperties().getProperty('OPENAI_API_KEY');
    if (!OPENAI_API_KEY) {
      Logger.log("ERROR: OPENAI_API_KEY 未在项目属性中配置。");
      return "AI深度研究失败：AI API Key未配置。";
    }

    // ✅ 调用 _collectAndFilterInternalData 并获取返回的对象
    const internalData = this._collectAndFilterInternalData(query);
    const internalDataContext = internalData.text;
    const collectedReferences = internalData.references;

    const prompt = `你是一名资深的技术与商业研究分析师，也是一位战略咨询顾问。你的任务是根据用户提供的研究查询，结合提供的内部数据库信息（如果相关），进行深入分析并生成一份结构化的报告。
    
    **重要提示：如果提供了“内部数据库信息”，你必须在报告中引用和使用这些信息。在报告的“关键发现”部分，如果某个发现或观点直接来源于你提供的“内部数据库信息”，请在该发现或观点后添加 **[内部数据]** 纯文本标记。**
    
    报告内容应包括：
    1. **摘要 (Summary):** 对研究主题的简明概述。
    2. **关键发现 (Key Findings):** 3-5个最重要的发现，应明确指出哪些发现是基于内部数据，哪些是基于AI的通用知识。
    3. **趋势与影响 (Trends and Impact):** 深入分析相关技术或市场的发展趋势，以及这些趋势可能带来的潜在影响和机会。
    4. **风险与挑战 (Risks and Challenges):** 指出潜在的风险、挑战或局限性。
    5. **战略建议 (Strategic Recommendations):** 基于上述分析，提出1-3条具体的、可操作的战略或策略建议。

    ${internalDataContext}

    请以Markdown格式输出报告，并严格遵循以下结构和格式要求：
    -   报告开头必须是：## **研究报告：[你的查询]**
    -   每个主要部分标题使用二级标题（## **标题**）格式。
    -   子项使用列表（-）。
    -   请勿在报告开头或结尾添加任何多余的空行或字符，确保报告内容以 ## 开头。
    -   所有引用内部数据的地方，请使用 **[内部数据]** 纯文本标记。
    -   **报告正文结束后，不要自行生成参考资料部分。**

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
          let aiGeneratedReport = jsonResponse.choices[0].message.content.trim(); 
          
          // ✅ 核心修改：在AI报告正文后，追加参考资料部分
          if (collectedReferences.length > 0) {
              aiGeneratedReport += "\n\n## **参考资料 (References)**\n";
              collectedReferences.forEach((ref, index) => {
                  const refTitle = ref.title || '无标题';
                  const refUrl = ref.url && ref.url !== '#' ? ref.url : '';
                  const refDate = ref.date || 'N/A';
                  const refType = ref.type || 'N/A';
                  const refPlatform = ref.source_platform && ref.source_platform !== 'N/A' ? ` (${ref.source_platform})` : '';

                  // 格式化参考资料为 Markdown 列表项
                  if (refUrl) {
                      aiGeneratedReport += `- [${refTitle}](${refUrl}) - ${refType}, ${refDate}${refPlatform}\n`;
                  } else {
                      aiGeneratedReport += `- ${refTitle} - ${refType}, ${refDate}${refPlatform}\n`;
                  }
              });
          }

          // ✅ 后端进行 Markdown 到 HTML 的转换和内部数据高亮
          const convertMarkdownToSafeHtml = (mdText) => {
              let htmlContent = mdText;

              // 1. 处理 ### 和 ## 标题
              htmlContent = htmlContent.replace(/^###\s*(.*)$/gm, '<h3>$1</h3>');
              htmlContent = htmlContent.replace(/^##\s*(.*)$/gm, '<h2>$1</h2>');
              htmlContent = htmlContent.replace(/^#\s*(.*)$/gm, '<h1>$1</h1>'); // 支持H1

              // 2. 处理列表 (-)
              htmlContent = htmlContent.replace(/^- (.+)$/gm, '<li>$1</li>');
              htmlContent = htmlContent.replace(/((?:<li>.*?<\/li>\s*)+)/gs, '<ul>$1</ul>');
              htmlContent = htmlContent.replace(/<\/li>\s*<li>/g, '</li><li>');

              // 3. 处理段落（将连续的非标题、非列表行视为段落）
              htmlContent = htmlContent.replace(/(<h[1-3]>.*?<\/h[1-3]>|<ul.*?<\/ul>|<ol.*?<\/ol>)/gs, '@@BLOCK_PLACEHOLDER@@$1@@BLOCK_PLACEHOLDER@@');
              htmlContent = htmlContent.split('@@BLOCK_PLACEHOLDER@@').map(segment => {
                  if (segment.startsWith('<h') || segment.startsWith('<ul') || segment.startsWith('<ol')) {
                      return segment;
                  }
                  return segment.split(/\n\s*\n/).map(p => {
                      p = p.trim();
                      if (p) return `<p>${p.replace(/\n/g, '<br>')}</p>`;
                      return '';
                  }).join('');
              }).join('');

              // 4. 处理粗体 (**) 和斜体 (*)
              htmlContent = htmlContent.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
              htmlContent = htmlContent.replace(/\*(.*?)\*/g, '<em>$1</em>');

              // 5. 处理内部数据标记 [内部数据] 并高亮
              htmlContent = htmlContent.replace(/\[内部数据\]/g, '<span class="internal-data-highlight">[内部数据]</span>');

              // 6. 处理 Markdown 链接 [text](url)
              htmlContent = htmlContent.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');


              // 7. 清理可能的多余空行
              htmlContent = htmlContent.replace(/<br>\s*<br>/g, '<br>');
              htmlContent = htmlContent.replace(/<p>\s*<\/p>/g, '');

              htmlContent = htmlContent.trim();
              
              return htmlContent;
          };

          const finalHtmlReport = convertMarkdownToSafeHtml(aiGeneratedReport);
          Logger.log(`[DeepResearchService] AI生成报告转换成功 (前500字符): ${finalHtmlReport.substring(0, 500)}...`);
          return finalHtmlReport;
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
