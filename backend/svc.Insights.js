// 文件名: backend/svc.Insights.gs

/**
 * @file 智能分析服务
 * 负责为“智能分析”页面提供数据聚合和计算服务。
 * 版本：4.0 - 新增趋势分析数据接口
 */
function _formatDateForInsights(d) {
  if (!d) return 'N/A';
  if (d instanceof Date) {
    if (!isNaN(d.getTime())) return d.toISOString().split('T')[0];
    return 'N/A';
  }
  const dateObj = new Date(d);
  if (!isNaN(dateObj.getTime())) return dateObj.toISOString().split('T')[0];
  return String(d);
}

// ==============================================================================
// 新增辅助函数：计算单项技术的成熟度阶段和商业价值评分
// ==============================================================================
/**
 * 计算给定技术在技术成熟度曲线上的 stage (X轴) 和 score (Y轴)。
 * 该函数会聚合来自多个原始数据源的指标进行计算。
 *
 * @param {object} tech - 来自 Technology_Registry 的单个技术对象。
 * @param {object} rawDataMap - 包含所有原始数据表的映射对象 (例如 { academicPapers: [], patentData: [] })。
 * @param {Array<object>} allIntelligenceData - Tech_Intelligence_Master 的所有数据。
 * @returns {object} 包含 calculated_stage 和 calculated_score 的对象。
 */
function _calculateHypeCycleScores(tech, rawDataMap, allIntelligenceData) {
  // ✅ DEBUG LOG: 进入 _calculateHypeCycleScores 函数
  Logger.log(`DEBUG: Entering _calculateHypeCycleScores for tech_id: ${tech.tech_id}, tech_name: ${tech.tech_name || 'N/A'}`);

  // 确保 tech_keyword 是字符串数组，用于过滤
  const techKeywords = tech.tech_keywords ? String(tech.tech_keywords).split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0) : [];
  // ✅ DEBUG LOG: 检查提取的关键词
  Logger.log(`DEBUG: Extracted keywords for ${tech.tech_name || tech.tech_id}: ${JSON.stringify(techKeywords)}`);

  if (techKeywords.length === 0) {
    // ✅ DEBUG LOG: 关键词为空，返回默认值
    Logger.log(`DEBUG: Tech ${tech.tech_name || tech.tech_id} has no valid keywords. Returning default scores (0, 1).`);
    return { calculated_stage: 0, calculated_score: 1 };
  }

  // ============== 1. 聚合各项指标的原始值 ==============
  let academic_innovation_score_sum = 0;
  let academic_paper_count = 0;
  let patent_importance_score_sum = 0;
  let patent_count = 0;
  let opensource_potential_score_sum = 0;
  let opensource_stars_sum = 0;
  // ✅ 修正：确保 opensource_projects_count 在这里被声明并初始化
  let opensource_projects_count = 0; 

  let news_value_score_sum = 0;
  let news_market_impact_sum = 0;
  let news_count = 0;
  let industry_impact_score_sum = 0;
  let industry_dynamics_count = 0;
  let competitor_threat_score_sum = 0;
  let competitor_business_impact_sum = 0;
  let ci_count = 0;
  let intelligence_signal_strength_sum = 0;
  let intelligence_breakthrough_score_sum = 0;
  let intelligence_count = 0;

  // 辅助函数：根据关键词过滤数据
  const filterByKeywords = (data, keywordField) => {
    return data.filter(item => {
      const itemKeywords = String(item[keywordField] || '').toLowerCase();
      // 检查 itemKeywords 是否为空，避免 includes(undefined) 报错
      if (!itemKeywords) return false; 
      return techKeywords.some(kw => itemKeywords.includes(kw));
    });
  };

  // 学术论文
  const relevantAcademicPapers = filterByKeywords(rawDataMap.academicPapers, 'tech_keywords');
  academic_paper_count = relevantAcademicPapers.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  academic_innovation_score_sum = relevantAcademicPapers.reduce((sum, p) => sum + (parseFloat(p.innovation_score) || 0), 0); 

  // 专利数据
  const relevantPatentData = filterByKeywords(rawDataMap.patentData, 'tech_keywords');
  patent_count = relevantPatentData.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  patent_importance_score_sum = relevantPatentData.reduce((sum, p) => sum + (parseFloat(p.importance_score) || 0), 0); 

  // 开源项目
  const relevantOpenSource = filterByKeywords(rawDataMap.openSourceData, 'tech_keywords');
  // ✅ 修正：添加这一行，为 opensource_projects_count 赋值
  opensource_projects_count = relevantOpenSource.length; 
  // ✅ 修正：更健壮的 parseFloat 转换
  opensource_potential_score_sum = relevantOpenSource.reduce((sum, os) => sum + (parseFloat(os.project_potential_score) || 0), 0); 
  // ✅ 修正：更健壮的 parseFloat 转换
  opensource_stars_sum = relevantOpenSource.reduce((sum, os) => sum + (parseFloat(os.github_stars) || 0), 0); 

  // 技术新闻
  const relevantTechNews = filterByKeywords(rawDataMap.techNews, 'tech_keywords');
  news_count = relevantTechNews.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  news_value_score_sum = relevantTechNews.reduce((sum, n) => sum + (parseFloat(n.news_value_score) || 0), 0); 
  // ✅ 修正：更健壮的 parseFloat 转换
  news_market_impact_sum = relevantTechNews.reduce((sum, n) => sum + (parseFloat(n.market_impact_score) || 0), 0); 

  // 产业动态 (假设通过 tech_keywords 关联)
  const relevantIndustryDynamics = filterByKeywords(rawDataMap.industryDynamics, 'tech_keywords');
  industry_dynamics_count = relevantIndustryDynamics.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  industry_impact_score_sum = relevantIndustryDynamics.reduce((sum, id) => sum + (parseFloat(id.industry_impact_score) || 0), 0); 

  // 竞争情报 (假设通过 tech_keywords 关联)
  const relevantCI = filterByKeywords(rawDataMap.competitorIntelligence, 'tech_keywords');
  ci_count = relevantCI.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  competitor_threat_score_sum = relevantCI.reduce((sum, ci) => sum + (parseFloat(ci.threat_level_score) || 0), 0); 
  // ✅ 修正：更健壮的 parseFloat 转换
  competitor_business_impact_sum = relevantCI.reduce((sum, ci) => sum + (parseFloat(ci.business_impact_score) || 0), 0); 

  // 核心情报 (通过 tech_id 关联，因为这里是 Tech_Intelligence_Master)
  const relevantIntelligence = allIntelligenceData.filter(ti => ti.tech_id === tech.tech_id);
  intelligence_count = relevantIntelligence.length;
  // ✅ 修正：更健壮的 parseFloat 转换
  intelligence_signal_strength_sum = relevantIntelligence.reduce((sum, ti) => sum + (parseFloat(ti.signal_strength) || 0), 0); 
  // ✅ 修正：更健壮的 parseFloat 转换
  intelligence_breakthrough_score_sum = relevantIntelligence.reduce((sum, ti) => sum + (parseFloat(ti.breakthrough_score) || 0), 0); 


  // ============== 2. 计算平均值和归一化 ==============
  // 注意：这里的MAX_值是估算，需要根据实际数据分布进行调整和优化
  // 理想情况下，这些MAX_值应从Config_DB中读取，作为归一化参数

  const MAX_ACADEMIC_COUNT = 50; // 近期相关论文最大数量
  const MAX_PATENT_COUNT = 30; // 近期相关专利最大数量
  const MAX_OPENSOURCE_STARS = 5000; // 开源项目最大星数
  const MAX_NEWS_COUNT = 100; // 新闻报道最大数量
  const MAX_INDUSTRY_DYNAMICS_COUNT = 20; // 产业动态最大数量
  const MAX_CI_COUNT = 20; // 竞争情报最大数量

  const MAX_SCORE_AI = 10; // AI评估分数最大值 (创新度、重要性、潜力、新闻价值、影响等)
  const MAX_SIGNAL_STRENGTH = 10; // 信号强度最大值 (Tech_Intelligence_Master)
  const MAX_BREAKTHROUGH_SCORE = 10; // 突破性评分最大值 (Tech_Intelligence_Master)


  const getNormalized = (value, max) => max > 0 ? Math.min(1, value / max) : 0;
  const getAvgNormalized = (sum, count, max) => count > 0 ? getNormalized(sum / count, max) : 0;

  // 成熟度相关归一化指标
  const norm_academic_innovation = getAvgNormalized(academic_innovation_score_sum, academic_paper_count, MAX_SCORE_AI);
  const norm_patent_importance = getAvgNormalized(patent_importance_score_sum, patent_count, MAX_SCORE_AI);
  const norm_opensource_potential = getAvgNormalized(opensource_potential_score_sum, opensource_projects_count, MAX_SCORE_AI);
  const norm_opensource_stars = getNormalized(opensource_stars_sum, MAX_OPENSOURCE_STARS);
  const norm_news_value = getAvgNormalized(news_value_score_sum, news_count, MAX_SCORE_AI);
  const norm_academic_count = getNormalized(academic_paper_count, MAX_ACADEMIC_COUNT);
  const norm_patent_count = getNormalized(patent_count, MAX_PATENT_COUNT);
  const norm_opensource_count = getNormalized(opensource_projects_count, 10); // 假设10个活跃项目就很高
  const norm_news_count = getNormalized(news_count, MAX_NEWS_COUNT);


  // 商业价值相关归一化指标
  const norm_news_market_impact = getAvgNormalized(news_market_impact_sum, news_count, MAX_SCORE_AI);
  const norm_industry_impact = getAvgNormalized(industry_impact_score_sum, industry_dynamics_count, MAX_SCORE_AI);
  const norm_competitor_business_impact = getAvgNormalized(competitor_business_impact_sum, ci_count, MAX_SCORE_AI);
  const norm_signal_strength = getAvgNormalized(intelligence_signal_strength_sum, intelligence_count, MAX_SIGNAL_STRENGTH);
  const norm_breakthrough_score = getAvgNormalized(intelligence_breakthrough_score_sum, intelligence_count, MAX_BREAKTHROUGH_SCORE);


  // ============== 3. 加权聚合计算 ==============
  // 权重需要根据实际业务需求和数据分布进行调优
  // 所有权重之和应为1，确保归一化后的结果在0-1之间

  // 成熟度阶段 (0-5)
  // 更侧重于研究和社区的活跃度
  let calculated_stage = (
      (norm_academic_innovation * 0.2) +        // 学术创新度
      (norm_academic_count * 0.15) +            // 论文数量
      (norm_patent_importance * 0.15) +         // 专利重要性
      (norm_patent_count * 0.1) +               // 专利数量
      (norm_opensource_potential * 0.1) +       // 开源潜力
      (norm_opensource_stars * 0.1) +           // 开源星数
      (norm_news_value * 0.1) +                 // 新闻关注度
      (norm_signal_strength * 0.1)              // 内部信号强度
  );
  calculated_stage = Math.round(calculated_stage * 5 * 10) / 10; // 映射到 0-5，并保留一位小数
  calculated_stage = Math.max(0.1, Math.min(5.0, calculated_stage)); // 确保在合理范围内

  // 商业价值评分 (1-10)
  // 更侧重于市场、商业和突破性
  let calculated_score = (
      (norm_news_market_impact * 0.25) +        // 新闻市场影响
      (norm_industry_impact * 0.2) +            // 产业影响
      (norm_competitor_business_impact * 0.2) + // 竞争对手商业影响
      (norm_breakthrough_score * 0.2) +         // 技术突破性
      (norm_signal_strength * 0.15)             // 内部信号强度
  );
  calculated_score = Math.round(calculated_score * 10 * 10) / 10; // 映射到 1-10，并保留一位小数
  calculated_score = Math.max(1.0, Math.min(10.0, calculated_score)); // 确保在合理范围内

  // ✅ DEBUG LOG: 计算结果
  Logger.log(`DEBUG: Calculation result for ${tech.tech_name || tech.tech_id}: stage=${calculated_stage}, score=${calculated_score}`);
  // ✅ 核心修改：返回一个包含所有必要数据的数组，而不是一个对象
  // 数组顺序：[成熟度阶段(X), 随机Y抖动, 商业价值评分(大小), 达到成熟期(Tooltip), 技术名称(Tooltip)]
  return [
    calculated_stage,
    10 + Math.random() * 80, // 直接在这里生成 yJitter
    calculated_score,
    tech.time_to_plateau || 'N/A', // 达到成熟期
    tech.tech_name // 技术名称
  ];
}

const InsightsService = {
  /**
   * [旧函数，可考虑移除] 获取主仪表板的KPI数据。
   * @returns {{total: number, highValue: number, executable: number}|{error: string}}
   */
  getDashboardKPIs() {
    try {
      const insights = DataService.getDataAsObjects(
        CONFIG.DATABASE_IDS.INTELLIGENCE_DB, 
        CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER
      );
      if (!insights) throw new Error("从DataService返回的洞察数据为空。");
      const totalInsights = insights.length;
      const highValueInsights = insights.filter(item => {
        const score = parseFloat(item.commercial_value_score);
        return !isNaN(score) && score >= 8.0;
      }).length;
      const executableInsights = insights.filter(item => 
        item.processing_status && item.processing_status.toLowerCase() === 'completed'
      ).length;
      return { total: totalInsights, highValue: highValueInsights, executable: executableInsights };
    } catch (e) {
      Logger.log(`Error in InsightsService.getDashboardKPIs: ${e.message} \n ${e.stack}`);
      throw new Error(`无法计算KPI: ${e.message}`);
    }
  },

    getInsightsPageData: function() {
    try {
      let trendData = { xAxis: [], seriesData: [] };
      let keywordData = [];
      let latestInsights = [];
      let hypeCycleData = [];

      // 1. 优化：一次性读取所有必要的数据源
      const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);

      // --- 实时获取所有原始数据，用于Hype Cycle计算 ---
      const rawDataMap = {
        academicPapers: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS),
        patentData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA),
        openSourceData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA),
        techNews: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS),
        industryDynamics: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS),
        competitorIntelligence: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE)
      };

      // --- 1. 获取趋势图数据 --- (保持不变)
      try {
        if (allInsights && allInsights.length > 0) {
          const monthlyCounts = {};
          const now = new Date();
          for (let i = 11; i >= 0; i--) {
            const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
            const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            monthlyCounts[monthKey] = 0;
          }
          allInsights.forEach(item => {
            const dateStr = _formatDateForInsights(item.created_timestamp);
            if (dateStr !== 'N/A') {
              const monthKey = dateStr.substring(0, 7);
              if (monthlyCounts.hasOwnProperty(monthKey)) {
                monthlyCounts[monthKey]++;
              }
            }
          });
          trendData.xAxis = Object.keys(monthlyCounts).sort();
          trendData.seriesData = trendData.xAxis.map(key => monthlyCounts[key]);
        }
      } catch (e) {
        Logger.log(`生成趋势图数据时出错: ${e.message}`);
      }

      // --- 2. 获取词云数据 --- (保持不变)
      try {
        if (allInsights && allInsights.length > 0) {
          let combinedText = '';
          allInsights.forEach(item => {
            combinedText += (item.title || '') + ' ';
            combinedText += (item.tech_keyword || '') + ' ';
          });
          
          if (combinedText.length > 0) {
            const wordCounts = {};
            const stopWords = new Set(['a', 'an', 'the', 'in', 'on', 'for', 'with', 'to', 'of', 'and', 'is', 'are', 'was', 'were', 'it', 'that', 'this', 'get', 'new', 'fully', 'system', 'web', 'via', 'how', 'use', 'using', 'based', 'its', 'also', 'can', 'we', 'our', 'data', 'model', 'approach', 'method', 'results', 'paper', 'study', 'research', 'analysis', 'propose', 'show']);
            const words = combinedText.toLowerCase().split(/[^a-z0-9]+/).filter(word => word && word.length > 3 && !stopWords.has(word) && isNaN(word));
            words.forEach(word => { wordCounts[word] = (wordCounts[word] || 0) + 1; });
            keywordData = Object.entries(wordCounts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 150);
          }
        }
      } catch(e) {
        Logger.log(`生成词云数据时出错: ${e.message}`);
      }
      
      // --- 3. 获取最新洞察列表数据 --- (保持不变)
      try {
        if (allInsights && allInsights.length > 0) {
          latestInsights = allInsights
              .slice(-10)
              .reverse()
              .filter(item => item && item.intelligence_id)
              .map(item => {
                  const processedDetail = {};
                  for (const key in item) {
                      if (item.hasOwnProperty(key)) {
                          processedDetail[key] = item[key] instanceof Date ? item[key].toISOString() : item[key];
                      }
                  }
                  return {
                      id: item.intelligence_id,
                      title: item.title,
                      source: item.trigger_source || item.source_table || '未知来源',
                      date: _formatDateForInsights(item.created_timestamp),
                      status: item.processing_status || '未知状态',
                      detail: processedDetail
                  };
              });
        }
      } catch(e) {
        Logger.log(`获取最新洞察线索时出错: ${e.message}`);
      }

      // --- 4. 获取技术成熟度曲线数据 (实时计算) ---
      try {
        if (allTechnologies && allTechnologies.length > 0) {
          Logger.log(`DEBUG: Entering loop to calculate Hype Cycle scores for ${allTechnologies.length} technologies.`);
          const hypeCycleProcessedData = [];
          for (const tech of allTechnologies) {
            // 调用 _calculateHypeCycleScores，它现在直接返回一个数组
            const calculatedDataArray = _calculateHypeCycleScores(tech, rawDataMap, allInsights);
            
            // 确保返回的是一个数组且包含足够的数据
            if (Array.isArray(calculatedDataArray) && calculatedDataArray.length >= 3) { // 至少包含 stage, yJitter, score
                hypeCycleProcessedData.push(calculatedDataArray);
            }
          }
          hypeCycleData = hypeCycleProcessedData;
          Logger.log(`DEBUG: Hype Cycle data processing completed. Total points: ${hypeCycleData.length}.`);
        } else {
          Logger.log('DEBUG: allTechnologies is empty or invalid. Hype Cycle data calculation skipped.');
        }
      } catch (e) {
        Logger.log(`ERROR: 获取技术成熟度曲线数据时出错: ${e.message}\n${e.stack}`);
      }

      // --- 5. 将所有数据打包在一个对象中返回 ---
      return {
        trendData: trendData,
        keywordData: keywordData,
        latestInsights: latestInsights,
        hypeCycleData: hypeCycleData // 现在这是一个 Array<Array>
      };

    } catch (e) {
      Logger.log(`getInsightsPageData 发生严重错误: ${e.message}\n${e.stack}`);
      throw new Error(`获取智能分析页面数据时发生严重错误: ${e.message}`);
    }
  },

  /**
   * ✅ 核心修改：将测试逻辑也作为服务的一个内部方法
   * 这样做可以完全避免任何全局作用域的命名冲突和初始化时序问题。
   */
  _runAllTests: function() {
    Logger.log("======== 开始运行所有 InsightsService 测试套件 ========");
    let allTestsPassed = true;
    
    // 测试用例 1: 获取旧版仪表板KPIs
    try { 
      Logger.log("\n--- 测试用例 1: 获取旧版仪表板KPIs ---");
      const kpis = this.getDashboardKPIs(); // 使用 this 调用
      if (kpis.error) throw new Error(kpis.error);
      Logger.log(`✅ 洞察KPIs成功: 总洞察 ${kpis.total}, 高价值 ${kpis.highValue}, 可执行 ${kpis.executable}`);
    } catch (e) {
      Logger.log(`❌ 测试用例 1 失败: ${e.message}`);
      allTestsPassed = false;
    }

    // 测试用例 2: 获取趋势分析数据
    try {
      Logger.log("\n--- 测试用例 2: 获取趋势分析数据 ---");
      const trendData = this.getTrendAnalysisData(); // 使用 this 调用
      if (trendData.error) throw new Error(trendData.error);
      if (!trendData.xAxis || !trendData.seriesData) throw new Error("返回的数据格式不正确。");
      Logger.log(`✅ 趋势分析数据获取成功: X轴(${trendData.xAxis.length}), Y轴(${trendData.seriesData.length})`);
    } catch (e) {
      Logger.log(`❌ 测试用例 2 失败: ${e.message}`);
      allTestsPassed = false;
    }

    // 你可以继续添加对 getKeywordCloudData 和 getLatestInsights 的测试...

    Logger.log("\n======== InsightsService 测试结束 ========");
    if (allTestsPassed) Logger.log("🎉 所有 InsightsService 测试用例通过!");
    else Logger.log("🔥 部分 InsightsService 测试用例失败，请检查日志。");
  }
};


// ====================================================================
//  T E S T   C O D E (已更新，包含对新函数的测试)
// ====================================================================

/**
 * 运行所有 InsightsService 相关的单元测试。
 */
function test_All_InsightsService() {
  InsightsService._runAllTests();
}
