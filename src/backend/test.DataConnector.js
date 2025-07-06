// 文件名: backend/test.DataConnector.gs

function test_DataConnector_All() {
  console.log("--- 开始 DataConnector 单元测试 ---");
  try {
    DataConnector.clearCache();
    
    console.log("\n[1/4] 测试 getSourceConfig...");
    const newsApiConfig = DataConnector.getSourceConfig('news_source', 'NEWSAPI_ORG');
    if (!newsApiConfig || newsApiConfig.source_id !== 'NEWSAPI_ORG' || !newsApiConfig.apiKey) {
      throw new Error("获取 NewsAPI 配置失败或API Key缺失。");
    }
    console.log("✅ getSourceConfig 测试通过。");

    console.log("\n[2/4] 测试 getAllActiveSourcesOfType...");
    const llmSources = DataConnector.getAllActiveSourcesOfType('llm_service');
    if (!llmSources || llmSources.length === 0 || llmSources[0].source_id !== 'OPENAI_API') {
      throw new Error("获取所有LLM服务源失败。");
    }
    console.log("✅ getAllActiveSourcesOfType 测试通过。");

    console.log("\n[3/4] 测试 fetchExternalData (NewsAPI)...");
    const newsResponse = DataConnector.fetchExternalData(newsApiConfig, 'everything', { q: 'Tesla', pageSize: 1 });
    if (!newsResponse || !newsResponse.articles) {
      throw new Error("从 NewsAPI 获取数据失败或返回格式不正确。");
    }
    console.log(`✅ fetchExternalData (NewsAPI) 测试通过，获取到文章: ${newsResponse.articles[0].title}`);

    console.log("\n[4/4] 测试 fetchExternalData (OpenAI)...");
    const openaiConfig = DataConnector.getSourceConfig('llm_service', 'OPENAI_API');
    const chatResponse = DataConnector.fetchExternalData(openaiConfig, 'chat_completions', {
      model: "gpt-3.5-turbo",
      messages: [{ role: "user", content: "Say 'Test OK'" }],
      max_tokens: 5
    });
    if (!chatResponse || !chatResponse.choices || chatResponse.choices[0].message.content.indexOf('Test OK') === -1) {
      throw new Error("从 OpenAI 获取数据失败或返回内容不正确。");
    }
    console.log(`✅ fetchExternalData (OpenAI) 测试通过，AI回复: ${chatResponse.choices[0].message.content}`);

    console.log("\n🎉🎉🎉 所有 DataConnector 测试成功！🎉🎉🎉");

  } catch (e) {
    console.error(`❌ DataConnector 测试失败: ${e.message}`, e.stack);
    throw e;
  }
}

// 文件名: backend/test.Workflows.AIHelpers.gs

function test_All_AI_Helpers() {
  console.log("=====================================================");
  console.log("--- 开始 AI 辅助函数集成测试 (通过 DataConnector) ---");
  console.log("=====================================================");

  try {
    // 清空缓存，确保每次测试都重新从Firestore加载配置
    DataConnector.clearCache();

    test_AI_Helper_TextGeneration();
    test_AI_Helper_Scoring();
    test_AI_Helper_Embedding();

    console.log("\n=====================================================");
    console.log("🎉🎉🎉 所有 AI 辅助函数测试成功！🎉🎉🎉");
    console.log("=====================================================");

  } catch (e) {
    console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error(`!!! AI 辅助函数测试失败: ${e.message} !!!`);
    console.error(`Stack: ${e.stack}`);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    throw e;
  }
}

function test_AI_Helper_TextGeneration() {
  console.log("\n[1/3] 测试 _callAIForTextGeneration...");
  const prompt = "生成一句关于软件架构的简短名言。";
  const result = WorkflowsService._callAIForTextGeneration(prompt);
  
  console.log(`  -> AI 返回: "${result}"`);
  if (!result || typeof result !== 'string' || result.includes('AI生成失败')) {
    throw new Error("_callAIForTextGeneration 返回了无效结果。");
  }
  console.log("✅ _callAIForTextGeneration 测试通过。");
}

function test_AI_Helper_Scoring() {
  console.log("\n[2/3] 测试 _callAIForScoring...");
  const prompt = `请分析以下文本的情感，并以JSON格式返回一个包含 "sentiment" (positive, negative, neutral) 和 "score" (0-10) 的对象。\n\n文本: "这款产品设计得非常出色，用户体验极佳！"`;
  const logContext = { wfName: 'AITest', logMessages: [] };
  const result = WorkflowsService._callAIForScoring(prompt, logContext);

  console.log(`  -> AI 返回: ${JSON.stringify(result)}`);
  if (!result || typeof result !== 'object' || !result.sentiment || typeof result.score !== 'number') {
    throw new Error("_callAIForScoring 返回了无效的JSON对象。");
  }
  if (result.sentiment.toLowerCase() !== 'positive') {
     console.warn(`  -> 警告: 情感分析结果可能不准确，但API调用成功。`);
  }
  console.log("✅ _callAIForScoring 测试通过。");
}

function test_AI_Helper_Embedding() {
  console.log("\n[3/3] 测试 _callAIForEmbedding...");
  const text = "Hello, world!";
  const result = WorkflowsService._callAIForEmbedding(text);

  if (!result || !Array.isArray(result) || result.length === 0) {
    throw new Error("_callAIForEmbedding 返回了无效的向量数组。");
  }
  console.log(`  -> AI 返回了一个包含 ${result.length} 个维度的向量。`);
  console.log("✅ _callAIForEmbedding 测试通过。");
}

// 添加到你的测试文件中
function test_All_Data_Collection_Workflows() {
  console.log("=====================================================");
  console.log("--- 开始数据采集层 (WF1-WF6) 端到端测试 ---");
  console.log("=====================================================");

  try {
    // 准备测试前提：确保有可供搜索的关键词
    // 建议在 `technology_registry` 和 `competitor_registry` 中创建专门的测试条目
    // 例如：一个包含关键词 "NVIDIA" 的技术领域，和一个名为 "Cisco Systems" 的竞争对手。
    console.log("ℹ️  测试前提：请确保配置中有活跃的、包含搜索词的监控实体。");


    // --- 逐一执行并验证每个工作流 ---

    test_WF1_AcademicPapers_Integration();
    
    test_WF2_PatentData_Integration();
    
    test_WF3_OpenSource_Integration();
    
    test_WF4_TechNews_Integration();
    
    test_WF5_IndustryDynamics_Integration();
    
    test_WF6_Benchmark_Integration();


    console.log("\n=====================================================");
    console.log("🎉🎉🎉 所有数据采集工作流 (WF1-WF6) 测试通过！🎉🎉🎉");
    console.log("=====================================================");

  } catch (e) {
    console.error("\n!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    console.error(`!!! 数据采集层测试失败: ${e.message} !!!`);
    console.error(`Stack: ${e.stack}`);
    console.error("!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!");
    throw e;
  }
}


function test_WF1_AcademicPapers_Integration() {
  console.log("\n[1/6] 正在测试 WF1: 学术论文监控...");
  try {
    const result = WorkflowsService.runWf1_AcademicPapers();
    console.log(`  -> WF1 结果: ${result.message}`);
    if (!result.success) {
      throw new Error(`WF1 执行失败: ${result.message}`);
    }
    console.log("✅ WF1: 测试通过。");
  } catch (e) {
    console.error(`❌ WF1 测试失败: ${e.message}`);
    throw e;
  }
}

function test_WF2_PatentData_Integration() {
  console.log("\n[2/6] 正在测试 WF2: 专利申请追踪...");
  try {
    const result = WorkflowsService.runWf2_PatentData();
    console.log(`  -> WF2 结果: ${result.message}`);
    // 由于此函数是占位符，我们只验证它是否成功返回
    if (!result.success) {
      throw new Error(`WF2 执行失败: ${result.message}`);
    }
    console.log("✅ WF2: 测试通过 (占位符函数执行成功)。");
  } catch (e) {
    console.error(`❌ WF2 测试失败: ${e.message}`);
    throw e;
  }
}

function test_WF3_OpenSource_Integration() {
  console.log("\n[3/6] 正在测试 WF3: 开源项目监测...");
  try {
    const result = WorkflowsService.runWf3_OpenSource();
    console.log(`  -> WF3 结果: ${result.message}`);
    if (!result.success) {
      throw new Error(`WF3 执行失败: ${result.message}`);
    }
    console.log("✅ WF3: 测试通过。");
  } catch (e) {
    console.error(`❌ WF3 测试失败: ${e.message}`);
    throw e;
  }
}

function test_WF4_TechNews_Integration() {
  console.log("\n[4/6] 正在测试 WF4: 技术新闻获取...");
  try {
    const result = WorkflowsService.runWf4_TechNews();
    console.log(`  -> WF4 结果: ${result.message}`);
    if (!result.success) {
      throw new Error(`WF4 执行失败: ${result.message}`);
    }
    console.log("✅ WF4: 测试通过。");
  } catch (e) {
    console.error(`❌ WF4 测试失败: ${e.message}`);
    throw e;
  }
}

function test_WF5_IndustryDynamics_Integration() {
  console.log("\n[5/6] 正在测试 WF5: 产业动态捕获...");
  try {
    const result = WorkflowsService.runWf5_IndustryDynamics();
    console.log(`  -> WF5 结果: ${result.message}`);
    // 由于此函数是占位符，我们只验证它是否成功返回
    if (!result.success) {
      throw new Error(`WF5 执行失败: ${result.message}`);
    }
    console.log("✅ WF5: 测试通过 (占位符函数执行成功)。");
  } catch (e) {
    console.error(`❌ WF5 测试失败: ${e.message}`);
    throw e;
  }
}

function test_WF6_Benchmark_Integration() {
  console.log("\n[6/6] 正在测试 WF6: 竞争对手情报收集...");
  try {
    const result = WorkflowsService.runWf6_Benchmark();
    console.log(`  -> WF6 结果: ${result.message}`);
    // 由于此函数是占位符，我们只验证它是否成功返回
    if (!result.success) {
      throw new Error(`WF6 执行失败: ${result.message}`);
    }
    console.log("✅ WF6: 测试通过 (占位符函数执行成功)。");
  } catch (e) {
    console.error(`❌ WF6 测试失败: ${e.message}`);
    throw e;
  }
}

function run_UTIL_ResetAllPendingStatuses() {
  console.log("==================================================");
  console.log("--- 开始重置所有RAW数据表的处理状态 ---");
  
  // 我们要重置这两个表，为图谱构建做准备
  const collectionsToReset = [
    'RAW_COMPETITOR_INTELLIGENCE',
    'RAW_INDUSTRY_DYNAMICS'
  ];

  collectionsToReset.forEach(key => {
    try {
      const result = WorkflowsService.resetRawDataStatus(key);
      console.log(`✅ 集合 ${key} 重置结果: ${result.message}`);
    } catch(e) {
      console.error(`❌ 集合 ${key} 重置失败: ${e.message}`);
    }
  });

  console.log("--- 所有状态重置操作已执行完毕 ---");
  console.log("==================================================");
}

/**
 * [全局诊断工具] 扫描整个数据处理链路的健康状况。
 * 轮询所有原始数据表，检查处理状态，并抽样验证图谱所需字段是否已回写。
 */
async function debug_scanDataPipelineHealth() {
  const startTime = new Date();
  Logger.log("==============================================================");
  Logger.log(`--- [全局数据链路健康度扫描] 开始执行 @ ${startTime.toLocaleString()} ---`);
  Logger.log("==============================================================");

  // 定义我们要扫描的所有原始数据集合及其关键检查字段
  const PIPELINE_CONFIG = [
    {
      key: 'RAW_COMPETITOR_INTELLIGENCE',
      displayName: '竞争情报',
      // 图谱构建依赖这些字段
      fieldsToCheck: ['intelligence_type', 'ai_extracted_products', 'ai_extracted_tech', 'ai_extracted_persons', 'ai_extracted_companies']
    },
    {
      key: 'RAW_INDUSTRY_DYNAMICS',
      displayName: '产业动态',
      // 图谱构建依赖这个字段
      fieldsToCheck: ['related_companies']
    },
    {
      key: 'RAW_ACADEMIC_PAPERS',
      displayName: '学术论文',
      // 专家网络图谱可能依赖这些字段
      fieldsToCheck: ['authors'] 
    },
    {
      key: 'RAW_PATENT_DATA',
      displayName: '专利数据',
      // 专家网络图谱可能依赖这些字段
      fieldsToCheck: ['inventors']
    }
    // 可以根据需要添加更多集合
  ];

  for (const config of PIPELINE_CONFIG) {
    Logger.log(`\n\n--- 正在扫描集合: [${config.displayName}] ---`);
    try {
      const allItems = DataService.getDataAsObjects(config.key);

      if (!allItems || allItems.length === 0) {
        Logger.log("  -> 结果: 集合为空，无需分析。");
        continue;
      }

      const total = allItems.length;
      const pendingCount = allItems.filter(item => item.processing_status === 'pending').length;
      const processedCount = allItems.filter(item => item.processing_status === 'processed').length;
      const failedCount = total - pendingCount - processedCount;

      // 打印状态统计
      Logger.log(`  -> 状态统计: 共 ${total} 条 | 待处理(pending): ${pendingCount} | 已处理(processed): ${processedCount} | 其他(failed/etc): ${failedCount}`);

      // 如果有已处理的数据，进行深度抽样检查
      if (processedCount > 0) {
        Logger.log(`  -> 开始对 ${processedCount} 条“已处理”记录进行抽样检查...`);
        
        const processedItems = allItems.filter(item => item.processing_status === 'processed');
        // 随机抽取最多3条进行检查
        const samples = processedItems.sort(() => 0.5 - Math.random()).slice(0, 3);
        
        let allSamplesOk = true;
        for (let i = 0; i < samples.length; i++) {
          const sample = samples[i];
          Logger.log(`    [样本 ${i+1}/${samples.length}] 检查文档 ID: ${sample.id}`);
          
          let sampleOk = true;
          for (const field of config.fieldsToCheck) {
            if (sample.hasOwnProperty(field) && sample[field] !== null && (Array.isArray(sample[field]) ? sample[field].length > 0 : true)) {
              Logger.log(`      [✓] 字段 '${field}' 存在且有值。`);
            } else {
              Logger.log(`      [❌] 关键字段 '${field}' 缺失或为空！`);
              sampleOk = false;
              allSamplesOk = false;
            }
          }
          if (!sampleOk) {
             Logger.log(`      -> 样本检查不通过。该文档内容: ${JSON.stringify(sample)}`);
          }
        }

        if (allSamplesOk) {
          Logger.log("  -> ✅ 抽样检查通过: “已处理”记录中包含了图谱所需的关键字段。");
        } else {
          Logger.log("  -> ❗️ 抽样检查失败: “已处理”记录中缺失了关键的AI抽取字段！问题锁定在对应的WF7-X工作流的数据回写步骤。");
        }

      } else {
        Logger.log("  -> 注意: 没有“已处理”状态的记录可供检查。请先运行对应的WF7-X信号识别工作流。");
      }
    } catch (e) {
      Logger.log(`  -> ❌ 扫描集合 ${config.key} 时发生严重错误: ${e.message}`);
    }
  }
  
  const endTime = new Date();
  const duration = (endTime.getTime() - startTime.getTime()) / 1000;
  Logger.log("\n==============================================================");
  Logger.log(`--- [全局数据链路健康度扫描] 结束，耗时: ${duration.toFixed(2)} 秒 ---`);
  Logger.log("==============================================================");
}
