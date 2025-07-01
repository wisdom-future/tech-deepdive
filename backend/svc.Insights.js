// 文件名: backend/svc.Insights.gs

/** @global CONFIG */
/** @global DataService */
/** @global DateUtils */
/** @global logDebug */
/** @global logInfo */
/** @global logWarning */
/** @global logError */

/**
 * @file 智能分析服务
 * 负责为“智能分析”页面提供数据聚合和计算服务。
 * 版本：4.0 - 新增趋势分析数据接口
 */

// Removed _formatDateForInsights as it's now centralized in DateUtils

// ==================================================================================================
// 新增辅助函数：计算单项技术的成熟度阶段和商业价值评分
// ==================================================================================================
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
  logDebug(`[InsightsService] Entering _calculateHypeCycleScores for tech_id: ${tech.tech_id}, tech_name: ${tech.tech_name || 'N/A'}`);

  // Ensure tech_keyword is a string array for filtering
  const techKeywords = tech.tech_keywords ? String(tech.tech_keywords).split(',').map(s => s.trim().toLowerCase()).filter(s => s.length > 0) : [];
  logDebug(`[InsightsService] Extracted keywords for ${tech.tech_name || tech.tech_id}: ${JSON.stringify(techKeywords)}`);

  if (techKeywords.length === 0) {
    logDebug(`[InsightsService] Tech ${tech.tech_name || tech.tech_id} has no valid keywords. Returning default scores (0, 1).`);
    return { calculated_stage: 0, calculated_score: 1 };
  }

  // ============================== 1. Aggregate raw values for each metric ==============================
  let academic_innovation_score_sum = 0;
  let academic_paper_count = 0;
  let patent_importance_score_sum = 0;
  let patent_count = 0;
  let opensource_potential_score_sum = 0;
  let opensource_stars_sum = 0;
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

  // Helper function to filter data by keywords
  const filterByKeywords = (data, keywordField) => {
    return data.filter(item => {
      const itemKeywords = String(item[keywordField] || '').toLowerCase();
      if (!itemKeywords) return false; 
      return techKeywords.some(kw => itemKeywords.includes(kw));
    });
  };

  // Academic Papers
  const relevantAcademicPapers = filterByKeywords(rawDataMap.academicPapers, 'tech_keywords');
  academic_paper_count = relevantAcademicPapers.length;
  academic_innovation_score_sum = relevantAcademicPapers.reduce((sum, p) => sum + (parseFloat(p.innovation_score) || 0), 0); 

  // Patent Data
  const relevantPatentData = filterByKeywords(rawDataMap.patentData, 'tech_keywords');
  patent_count = relevantPatentData.length;
  patent_importance_score_sum = relevantPatentData.reduce((sum, p) => sum + (parseFloat(p.importance_score) || 0), 0); 

  // Open Source Projects
  const relevantOpenSource = filterByKeywords(rawDataMap.openSourceData, 'tech_keywords');
  opensource_projects_count = relevantOpenSource.length; 
  opensource_potential_score_sum = relevantOpenSource.reduce((sum, os) => sum + (parseFloat(os.project_potential_score) || 0), 0); 
  opensource_stars_sum = relevantOpenSource.reduce((sum, os) => sum + (parseFloat(os.github_stars) || 0), 0); 

  // Tech News
  const relevantTechNews = filterByKeywords(rawDataMap.techNews, 'tech_keywords');
  news_count = relevantTechNews.length;
  news_value_score_sum = relevantTechNews.reduce((sum, n) => sum + (parseFloat(n.news_value_score) || 0), 0); 
  news_market_impact_sum = relevantTechNews.reduce((sum, n) => sum + (parseFloat(n.market_impact_score) || 0), 0); 

  // Industry Dynamics (assuming linked by tech_keywords)
  const relevantIndustryDynamics = filterByKeywords(rawDataMap.industryDynamics, 'tech_keywords');
  industry_dynamics_count = relevantIndustryDynamics.length;
  industry_impact_score_sum = relevantIndustryDynamics.reduce((sum, id) => sum + (parseFloat(id.industry_impact_score) || 0), 0); 

  // Competitor Intelligence (assuming linked by tech_keywords)
  const relevantCI = filterByKeywords(rawDataMap.competitorIntelligence, 'tech_keywords');
  ci_count = relevantCI.length;
  competitor_threat_score_sum = relevantCI.reduce((sum, ci) => sum + (parseFloat(ci.threat_level_score) || 0), 0); 
  competitor_business_impact_sum = relevantCI.reduce((sum, ci) => sum + (parseFloat(ci.business_impact_score) || 0), 0); 

  // Core Intelligence (linked by tech_id, as this is Tech_Intelligence_Master)
  const relevantIntelligence = allIntelligenceData.filter(ti => ti.tech_id === tech.tech_id);
  intelligence_count = relevantIntelligence.length;
  intelligence_signal_strength_sum = relevantIntelligence.reduce((sum, ti) => sum + (parseFloat(ti.signal_strength) || 0), 0); 
  intelligence_breakthrough_score_sum = relevantIntelligence.reduce((sum, ti) => sum + (parseFloat(ti.breakthrough_score) || 0), 0); 


  // ============================== 2. Calculate averages and normalize ==============================
  // Note: MAX_ values are estimates; adjust them based on actual data distribution.
  // Ideally, these MAX_ values should be read from Config_DB as normalization parameters.

  const MAX_ACADEMIC_COUNT = 50; 
  const MAX_PATENT_COUNT = 30; 
  const MAX_OPENSOURCE_STARS = 5000; 
  const MAX_NEWS_COUNT = 100; 
  const MAX_INDUSTRY_DYNAMICS_COUNT = 20; 
  const MAX_CI_COUNT = 20; 

  const MAX_SCORE_AI = 10; 
  const MAX_SIGNAL_STRENGTH = 10; 
  const MAX_BREAKTHROUGH_SCORE = 10; 


  const getNormalized = (value, max) => max > 0 ? Math.min(1, value / max) : 0;
  const getAvgNormalized = (sum, count, max) => count > 0 ? getNormalized(sum / count, max) : 0;

  // Maturity-related normalized indicators
  const norm_academic_innovation = getAvgNormalized(academic_innovation_score_sum, academic_paper_count, MAX_SCORE_AI);
  const norm_patent_importance = getAvgNormalized(patent_importance_score_sum, patent_count, MAX_SCORE_AI);
  const norm_opensource_potential = getAvgNormalized(opensource_potential_score_sum, opensource_projects_count, MAX_SCORE_AI);
  const norm_opensource_stars = getNormalized(opensource_stars_sum, MAX_OPENSOURCE_STARS);
  const norm_news_value = getAvgNormalized(news_value_score_sum, news_count, MAX_SCORE_AI);
  const norm_academic_count = getNormalized(academic_paper_count, MAX_ACADEMIC_COUNT);
  const norm_patent_count = getNormalized(patent_count, MAX_PATENT_COUNT);
  const norm_opensource_count = getNormalized(opensource_projects_count, 10); // Assume 10 active projects is high
  const norm_news_count = getNormalized(news_count, MAX_NEWS_COUNT);


  // Business value-related normalized indicators
  const norm_news_market_impact = getAvgNormalized(news_market_impact_sum, news_count, MAX_SCORE_AI);
  const norm_industry_impact = getAvgNormalized(industry_impact_score_sum, industry_dynamics_count, MAX_SCORE_AI);
  const norm_competitor_business_impact = getAvgNormalized(competitor_business_impact_sum, ci_count, MAX_SCORE_AI);
  const norm_signal_strength = getAvgNormalized(intelligence_signal_strength_sum, intelligence_count, MAX_SIGNAL_STRENGTH);
  const norm_breakthrough_score = getAvgNormalized(intelligence_breakthrough_score_sum, intelligence_count, MAX_BREAKTHROUGH_SCORE);


  // ============================== 3. Weighted aggregation calculation ==============================
  // Weights need to be tuned based on actual business needs and data distribution.
  // The sum of all weights should be 1 to ensure normalized results are between 0 and 1.

  // Maturity Stage (0-5)
  // More focused on research and community activity
  let calculated_stage = (
      (norm_academic_innovation * 0.2) +        // Academic innovation
      (norm_academic_count * 0.15) +            // Number of papers
      (norm_patent_importance * 0.15) +         // Patent importance
      (norm_patent_count * 0.1) +               // Number of patents
      (norm_opensource_potential * 0.1) +       // Open source potential
      (norm_opensource_stars * 0.1) +           // Open source stars
      (norm_news_value * 0.1) +                 // News attention
      (norm_signal_strength * 0.1)              // Internal signal strength
  );
  calculated_stage = Math.round(calculated_stage * 5 * 10) / 10; // Map to 0-5, and keep one decimal place
  calculated_stage = Math.max(0.1, Math.min(5.0, calculated_stage)); // Ensure within reasonable range

  // Business Value Score (1-10)
  // More focused on market, business, and breakthrough potential
  let calculated_score = (
      (norm_news_market_impact * 0.25) +        // News market impact
      (norm_industry_impact * 0.2) +            // Industry impact
      (norm_competitor_business_impact * 0.2) + // Competitor business impact
      (norm_breakthrough_score * 0.2) +         // Technology breakthrough
      (norm_signal_strength * 0.15)             // Internal signal strength
  );
  calculated_score = Math.round(calculated_score * 10 * 10) / 10; // Map to 1-10, and keep one decimal place
  calculated_score = Math.max(1.0, Math.min(10.0, calculated_score)); // Ensure within reasonable range

  logDebug(`[InsightsService] Calculation result for ${tech.tech_name || tech.tech_id}: stage=${calculated_stage}, score=${calculated_score}`);
  // Core change: Return an array containing all necessary data, not an object
  // Array order: [Maturity Stage (X), Random Y jitter, Business Value Score (size), Time to Plateau (Tooltip), Technology Name (Tooltip)]
  return [
    calculated_stage,
    10 + Math.random() * 80, // Directly generate yJitter
    calculated_score,
    tech.time_to_plateau || 'N/A', // Time to plateau
    tech.tech_name // Technology name
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
      logError(`[InsightsService] Error in InsightsService.getDashboardKPIs: ${e.message} \n ${e.stack}`);
      throw new Error(`无法计算KPI: ${e.message}`);
    }
  },

    getInsightsPageData: function() {
    try {
      let trendData = { xAxis: [], seriesData: [] };
      let keywordData = [];
      let latestInsights = [];
      let hypeCycleData = [];

      // 1. Optimize: Read all necessary data sources at once
      const allInsights = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.INTELLIGENCE_DB, CONFIG.SHEET_NAMES.TECH_INSIGHTS_MASTER);
      const allTechnologies = DataService.getDataAsObjects(CONFIG.DATABASE_IDS.CONFIG_DB, CONFIG.SHEET_NAMES.TECH_REGISTRY);

      // --- Real-time fetching of all raw data for Hype Cycle calculation ---
      const rawDataMap = {
        academicPapers: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_ACADEMIC_PAPERS),
        patentData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_PATENT_DATA),
        openSourceData: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_OPENSOURCE_DATA),
        techNews: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_TECH_NEWS),
        industryDynamics: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_INDUSTRY_DYNAMICS),
        competitorIntelligence: DataService.getDataAsObjects(CONFIG.DATABASE_IDS.RAWDATA_DB, CONFIG.SHEET_NAMES.RAW_COMPETITOR_INTELLIGENCE)
      };

      // --- 1. Get Trend Chart Data --- (unchanged)
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
            const dateStr = DateUtils.formatDate(item.created_timestamp); // Use DateUtils
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
        logError(`[InsightsService] Error generating trend chart data: ${e.message}`);
      }

      // --- 2. Get Word Cloud Data --- (unchanged)
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
        logError(`[InsightsService] Error generating word cloud data: ${e.message}`);
      }
      
      // --- 3. Get Latest Insights List Data --- (unchanged)
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
                          processedDetail[key] = (item[key] instanceof Date) ? DateUtils.formatDate(item[key], true) : item[key]; // Use DateUtils
                      }
                  }
                  return {
                      id: item.intelligence_id,
                      title: item.title,
                      source: item.trigger_source || item.source_table || '未知来源',
                      date: DateUtils.formatDate(item.created_timestamp), // Use DateUtils
                      status: item.processing_status || '未知状态',
                      detail: processedDetail
                  };
              });
        }
      } catch(e) {
        logError(`[InsightsService] Error getting latest insights: ${e.message}`);
      }

      // --- 4. Get Technology Hype Cycle Data (real-time calculation) ---
      try {
        if (allTechnologies && allTechnologies.length > 0) {
          logDebug(`[InsightsService] Entering loop to calculate Hype Cycle scores for ${allTechnologies.length} technologies.`);
          const hypeCycleProcessedData = [];
          for (const tech of allTechnologies) {
            // Call _calculateHypeCycleScores, which now directly returns an array
            const calculatedDataArray = _calculateHypeCycleScores(tech, rawDataMap, allInsights);
            
            // Ensure it returns an array with enough data
            if (Array.isArray(calculatedDataArray) && calculatedDataArray.length >= 3) { // At least stage, yJitter, score
                hypeCycleProcessedData.push(calculatedDataArray);
            }
          }
          hypeCycleData = hypeCycleProcessedData;
          logDebug(`[InsightsService] Hype Cycle data processing completed. Total points: ${hypeCycleData.length}.`);
        } else {
          logDebug('[InsightsService] allTechnologies is empty or invalid. Hype Cycle data calculation skipped.');
        }
      } catch (e) {
        logError(`[InsightsService] ERROR: Error getting technology hype cycle data: ${e.message}\n${e.stack}`);
      }

      // --- 5. Package all data in an object and return ---
      return {
        trendData: trendData,
        keywordData: keywordData,
        latestInsights: latestInsights,
        hypeCycleData: hypeCycleData // Now this is an Array<Array>
      };

    } catch (e) {
      logError(`[InsightsService] getInsightsPageData critical error: ${e.message}\n${e.stack}`);
      throw new Error(`获取智能分析页面数据时发生严重错误: ${e.message}`);
    }
  },

  /**
   * ✅ Core change: Make test logic an internal method of the service
   * This completely avoids any global scope naming conflicts and initialization timing issues.
   */
  _runAllTests: function() {
    logInfo("======== 开始运行所有 InsightsService 测试套件 ========");
    let allTestsPassed = true;
    
    // Test Case 1: Get old dashboard KPIs
    try { 
      logInfo("\n--- 测试用例 1: 获取旧版仪表板KPIs ---");
      const kpis = this.getDashboardKPIs(); // Use this to call
      if (kpis.error) throw new Error(kpis.error);
      logInfo(`✅ 洞察KPIs成功: 总洞察 ${kpis.total}, 高价值 ${kpis.highValue}, 可执行 ${kpis.executable}`);
    } catch (e) {
      logError(`❌ 测试用例 1 失败: ${e.message}`);
      allTestsPassed = false;
    }

    // Test Case 2: Get trend analysis data (This method does not exist in the current service, it's aggregated in getInsightsPageData)
    // This test case will be removed or adapted if InsightsService.getTrendAnalysisData() is not a standalone method.
    // Since getInsightsPageData now returns all data, we will test that.
    try {
      logInfo("\n--- 测试用例 2: 获取 Insights 页面所有数据 (包含趋势图数据) ---");
      const pageData = this.getInsightsPageData(); // Use this to call
      if (pageData.error) throw new Error(pageData.error);
      if (!pageData.trendData || !pageData.trendData.xAxis || !pageData.trendData.seriesData) throw new Error("趋势图数据格式不正确。");
      logInfo(`✅ 趋势分析数据获取成功: X轴(${pageData.trendData.xAxis.length}), Y轴(${pageData.trendData.seriesData.length})`);
      if (!pageData.keywordData || pageData.keywordData.length === 0) logWarning(`  - 词云数据为空。`);
      if (!pageData.latestInsights || pageData.latestInsights.length === 0) logWarning(`  - 最新洞察数据为空。`);
      if (!pageData.hypeCycleData || pageData.hypeCycleData.length === 0) logWarning(`  - 技术成熟度曲线数据为空。`);
      logInfo(`✅ Insights 页面数据聚合成功。`);
    } catch (e) {
      logError(`❌ 测试用例 2 失败: ${e.message}`);
      allTestsPassed = false;
    }

    logInfo("\n======== InsightsService 测试结束 ========");
    if (allTestsPassed) logInfo("🎉 所有 InsightsService 测试用例通过!");
    else logError("🔥 部分 InsightsService 测试用例失败，请检查日志。");
  }
};


// ==================================================================================
//  T E S T   C O D E (已更新，包含对新函数的测试)
// ==================================================================================

/**
 * 运行所有 InsightsService 相关的单元测试。
 */
function test_All_InsightsService() {
  InsightsService._runAllTests();
}