/**
 * @file MockFactory.gs
 * @description [测试工具] 提供所有测试所需的MOCK对象和数据。
 * 集中管理MOCK的创建，使测试用例更清晰。
 */
const MockFactory = {

  /**
   * 创建一个MOCK的UrlFetchApp对象，可以动态设置响应。
   */
  createMockUrlFetchApp: function() {
    return {
      _mockResponse: null,
      setResponse: function(code, content) {
        this._mockResponse = {
          getResponseCode: () => code,
          getContentText: () => content,
          getBlob: () => ({ getBytes: () => new Blob([content]).size })
        };
      },
      fetch: function(url, params) {
        Logger.log(`[MOCK] UrlFetchApp.fetch called for URL: ${url}`);
        if (this._mockResponse) {
          return this._mockResponse;
        }
        return { getResponseCode: () => 404, getContentText: () => '{"error":"No mock response set"}' };
      }
    };
  },

 createMockSourceConfig: function(type = 'news') {
    const baseConfig = {
      request_method: "GET",
      response_type: "json",
      collection_endpoint_key: "default_endpoint"
    };

    if (type === 'news') {
      return {
        ...baseConfig,
        source_id: "MOCK_NEWS_API",
        display_name: "Mock News Source",
        response_mapping_rules: {
          items_path: "articles",
          fields: { title: "title", summary: "description", url: "url" }
        }
      };
    }
    
    if (type === 'paper') {
      return {
        ...baseConfig,
        source_id: "MOCK_PAPER_API",
        display_name: "Mock Paper Source",
        response_type: "xml",
        response_mapping_rules: {
          items_path: "entry", // XML中通常是entry
          fields: { title: "title", summary: "summary", url: "id" }
        }
      };
    }

    return baseConfig;
  },

  /**
   * 创建一个MOCK的实体对象。
   */
  createMockEntity: function(type = 'Technology', id = 'test_tech_001', name = 'Test Technology') {
    const entity = {
      entity_id: id,
      primary_name: name,
      entity_type: type,
      monitoring_status: 'active'
    };
    if (type === 'Technology') {
      entity.tech_keywords = name;
    } else if (type === 'Company') {
      entity.stock_symbol = name.toUpperCase();
    }
    return entity;
  },

  /**
   * 创建一个MOCK的API响应。
   */
  createMockApiResponse: function(type = 'news') {
    if (type === 'news') {
      return JSON.stringify({
        articles: [{ title: 'Mock News Title', description: 'News summary.' }]
      });
    }
    if (type === 'paper') {
      return `<?xml version="1.0"?><feed><entry><title>Mock Paper Title</title><summary>Paper summary.</summary></entry></feed>`;
    }
    return '{}';
  },


  /**
   * 创建一个MOCK的AI分析结果。
   */
  createMockAiAnalysisResponse: function(taskId = 'mock_task_id') {
    return {
      results: [{
        id: taskId,
        analysis: {
          value_score: 8, ai_summary: 'A mock summary about the topic.', ai_keywords: ['Mock', 'AI'],
          candidate_companies: ['MockCorp'], candidate_techs: ['MockTech'], candidate_persons: [],
          candidate_financial_concepts: [], candidate_organization_lists: [], candidate_business_events: [],
          candidate_research_firms: [], candidate_publishing_platforms: []
        }
      }]
    };
  },

  /**
   * 创建一个MOCK的AI实体归一化结果。
   */
  createMockAiNormalizationResponse: function() {
    return {
      normalized_groups: [{ primary_name: 'MockCorp', aliases: ['Mock Corporation'] }]
    };
  },

  /**
   * 创建一个MOCK的AI嵌入向量结果。
   */
  createMockAiEmbeddingResponse: function(count = 1) {
    const embeddings = Array(count).fill(null).map((_, i) => ({
      index: i,
      embedding: [0.1, 0.2, 0.3 + i * 0.1]
    }));
    return { data: embeddings };
  },

  /**
   * 创建一个MOCK的XmlService对象。
   */
  createMockXmlService: function() {
    const mockXmlElement = {
      getChild: (tagName, ns) => ({ getText: () => `Mock XML ${tagName}` }),
      getChildren: (tagName, ns) => [mockXmlElement]
    };
    return {
      parse: (xmlString) => ({ getRootElement: () => mockXmlElement }),
      getNamespace: (uri) => ({})
    };
  }
};
