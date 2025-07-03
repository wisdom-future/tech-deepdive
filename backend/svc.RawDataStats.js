// 文件名: backend/svc.RawDataStats.gs (最终诊断版)

const RawDataStatsService = {
  getStats: function() {
    Logger.log("--- RawDataStatsService.getStats() 开始执行 ---");
    try {
      const sevenDaysAgo = new Date();
      sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
      
      const rawDataCategories = [
          { key: 'RAW_ACADEMIC_PAPERS', name: 'academicPapers', tsField: 'publication_date' },
          { key: 'RAW_TECH_NEWS', name: 'techNews', tsField: 'publication_date' },
          { key: 'RAW_INDUSTRY_DYNAMICS', name: 'industryDynamics', tsField: 'publication_date' },
          { key: 'RAW_PATENT_DATA', name: 'patentData', tsField: 'created_timestamp' },
          { key: 'RAW_OPENSOURCE_DATA', name: 'openSourceData', tsField: 'created_timestamp' },
          { key: 'RAW_COMPETITOR_INTELLIGENCE', name: 'competitorIntelligence', tsField: 'publication_date' }
      ];

      const rawDataStats = { total: 0, sevenDayIngestion: 0, categories: {}, sevenDayCategories: {} };

      Logger.log("--- 开始遍历每个 RawData 集合 ---");
      for (const cat of rawDataCategories) {
        Logger.log(`\n[正在处理集合: ${cat.key}]`);
        const allData = DataService.getDataAsObjects(cat.key);
        
        if (!allData || allData.length === 0) {
            Logger.log("  -> 数据为空或获取失败，跳过。");
            continue;
        }
        
        const totalCount = allData.length;
        Logger.log(`  -> 获取到 ${totalCount} 条记录。`);

        // ✅ 关键诊断：检查第一条记录的时间戳字段
        const firstRecord = allData[0];
        const timestampField = cat.tsField;
        const timestampValue = firstRecord[timestampField];
        Logger.log(`  -> 第一条记录的时间戳字段 ('${timestampField}') 的值为: ${timestampValue} (类型: ${typeof timestampValue})`);

        let sevenDayCount = 0;
        try {
            sevenDayCount = allData.filter(item => {
              const val = item[timestampField];
              if (!val) return false;
              // Firestore 返回的时间戳字符串或 Date 对象都可以被 new Date() 正确解析
              const itemDate = new Date(val); 
              // ✅ 关键诊断：打印出解析后的日期
              // if (item === firstRecord) { Logger.log(`  -> 解析后的日期对象: ${itemDate.toISOString()}`); }
              return !isNaN(itemDate.getTime()) && itemDate >= sevenDaysAgo;
            }).length;
        } catch(filterError) {
            Logger.log(`  -> !!! 在过滤日期时发生错误: ${filterError.message}`);
        }
        
        Logger.log(`  -> 计算结果: 总数=${totalCount}, 近7日=${sevenDayCount}`);

        rawDataStats.categories[cat.name] = totalCount;
        rawDataStats.sevenDayCategories[cat.name] = sevenDayCount;
        rawDataStats.total += totalCount;
        rawDataStats.sevenDayIngestion += sevenDayCount;
      }

      Logger.log("\n--- 最终统计结果 ---");
      Logger.log(JSON.stringify(rawDataStats));
      
      return rawDataStats;
    } catch (e) {
      Logger.log(`!!! ERROR in RawDataStatsService.getStats: ${e.message} \n ${e.stack}`);
      throw new Error(`无法获取原始数据统计: ${e.message}`);
    }
  }
};
