/**
 * @file layer00.Prompts.gs
 * @description 全局共享的AI Prompt模板库。
 * 这是一个无状态的工具模块，为所有服务提供标准化的Prompt。
 */

const PromptLibrary = {

  /**
   * 根据模板名称获取对应的Prompt字符串。
   * @param {string} templateName - 模板的唯一名称。
   * @returns {string} Prompt模板字符串，如果未找到则返回空字符串。
   */
  get: function(templateName) {
    const templates = {

      //============================================
      // BATCH PROCESSING PROMPTS (用于数据加工)
      //============================================
      
      'news_analysis_batch': `
        You are a world-class financial and technology intelligence analyst. Your primary goal is to identify strategic signals from a batch of news articles, filtering out irrelevant noise.
        For each news item provided in the input JSON, you must perform a detailed analysis and structure your response precisely as instructed.

        Your final output for the entire batch MUST be a single, valid JSON object. This object must contain a "results" key, which holds an array of result objects.

        Each result object in your output's "results" array MUST correspond to a task from the input.
        It is ABSOLUTELY CRITICAL that the "id" field in your output object EXACTLY MATCHES the "id" of the corresponding input task. Do not alter, omit, or generate new IDs. This is the most important instruction.

        Input tasks JSON: {TASKS_JSON}

        For each task, your response object must contain two top-level keys: "id" and "analysis".
        The "analysis" object itself must contain the following fields based on your evaluation:

        1.  **value_score**: Critically evaluate the strategic importance of the information for a technology investor on a scale of 0 to 10.
            - 0-3: Routine news, PR, minor updates, or public noise. (e.g., a small product update, a generic market report)
            - 4-6: Potentially interesting event. (e.g., a new partnership, a notable executive hire, a significant product launch)
            - 7-8: High-impact strategic signal. (e.g., a major acquisition announcement, entering a new market, significant financial results, a lawsuit with major implications)
            - 9-10: A critical, must-know event that could reshape a company or market. (e.g., a disruptive technology breakthrough, a CEO being fired, a major regulatory crackdown)
            This must be an integer.

        2.  **ai_summary**: A neutral, factual summary of the news item's core message in one or two sentences.

        3.  **ai_keywords**: The most relevant keywords that capture the essence of the article.

        4.  **Entity Extraction Fields** (candidate_companies, candidate_techs, etc.): Identify all potential named entities mentioned in the text. If no entities of a certain type are found, you MUST return an empty array [], not null.

        The required structure for each result object is as follows:
        {
          "id": "THE_ORIGINAL_ID_FROM_THE_CORRESPONDING_INPUT_TASK",
          "analysis": {
            "value_score": <An integer from 0 to 10>,
            "ai_summary": "A neutral, factual summary of the text's key information.",
            "ai_keywords": ["keyword1", "keyword2"],
            "candidate_companies": ["Company Name Inc."],
            "candidate_techs": ["AI", "Quantum Computing"],
            "candidate_persons": ["Jane Doe"],
            "candidate_financial_concepts": ["EBITDA"],
            "candidate_organization_lists": ["S&P 500"],
            "candidate_business_events": ["acquisition"],
            "candidate_research_firms": ["Gartner"],
            "candidate_publishing_platforms": ["Bloomberg"]
          }
        }
        `,
      'papers_analysis_batch': `
        You are a world-class academic and technology intelligence analyst. Your goal is to evaluate the significance of academic papers for a corporate technology strategy team.
        For each paper provided in the input JSON, perform a detailed analysis and structure your response precisely as instructed.

        Your final output for the entire batch MUST be a single, valid JSON object with a "results" key, which holds an array of result objects.
        Each result object in your output's "results" array MUST correspond to a task from the input, matching the "id" field exactly.

        Input tasks JSON: {TASKS_JSON}

        For each task, your response object must contain "id" and "analysis".
        The "analysis" object must contain the following fields:

        1.  **value_score**: Critically evaluate the paper's potential impact and relevance on a scale of 0 to 10.
            - 0-3: Incremental work, student projects, highly theoretical, or very niche topics with low commercial potential.
            - 4-6: Solid academic work. It might be a new application of an existing method, a decent performance improvement, or a good survey paper. Potentially interesting.
            - 7-8: High-impact paper. It might propose a novel and effective method, present breakthrough results, or be published by a top-tier lab or a major tech company (e.g., Google Brain, DeepMind).
            - 9-10: A seminal, must-read paper that could define a new field, solve a long-standing problem, or have immediate, significant implications for technology products.
            This must be an integer.

        2.  **ai_summary**: A neutral, factual summary of the paper's core contribution: the problem it addresses, the proposed method, and the key results.

        3.  **ai_keywords**: The most relevant technical keywords from the paper.

        4.  **Entity Extraction Fields**: Identify all potential named entities. If none are found for a type, return an empty array [].

        The required structure for each result object is as follows:
        {
          "id": "THE_ORIGINAL_ID_FROM_THE_INPUT_TASK",
          "analysis": {
            "value_score": <An integer from 0 to 10 based on the criteria above>,
            "ai_summary": "Summarize the core problem, method, and results.",
            "ai_keywords": ["Extract key technical terms"],
            "candidate_companies": ["Extract any mentioned company names"],
            "candidate_techs": ["Extract key technologies and methods"],
            "candidate_persons": ["Extract author names"],
            "candidate_financial_concepts": [],
            "candidate_organization_lists": ["Extract author affiliations/labs, e.g., 'Stanford University', 'Google Research'"],
            "candidate_business_events": [],
            "candidate_research_firms": [],
            "candidate_publishing_platforms": ["Extract conference or journal name if available, e.g., 'NeurIPS', 'ICML'"]
          }
        }
        `,
      
      'patents_analysis_batch': `
        You are an expert patent analyst bot. Analyze a batch of patents.
        For each patent, focus on its core claims, novelty, and the technology domain it protects.
        Input is a JSON object of tasks. Your response MUST be a single, valid JSON object with a "results" key.
        Each result object must have an "id" and an "analysis" object.

        Input tasks JSON: {TASKS_JSON}

        The "analysis" object for each result MUST have this exact JSON format:
        {
            "value_score": 0, "ai_summary": "Summarize the patent's main invention and purpose.", "ai_keywords": ["Extract key technical terms from claims"], "candidate_companies": ["Extract assignee/company names"], "candidate_techs": [], "candidate_persons": ["Extract inventor names"],
            "candidate_financial_concepts": [], "candidate_organization_lists": [], "candidate_business_events": ["patent filing", "patent grant"],
            "candidate_research_firms": [], "candidate_publishing_platforms": []
        }
      `,
      
      'jobs_analysis_batch': `
        You are an HR and technology strategist bot. Analyze a batch of job postings.
        For each posting, identify the strategic importance, required skills, and seniority.
        Input is a JSON object of tasks. Your response MUST be a single, valid JSON object with a "results" key.
        Each result object must have an "id" and an "analysis" object.

        Input tasks JSON: {TASKS_JSON}

        The "analysis" object for each result MUST have this exact JSON format:
        {
            "value_score": 0, "ai_summary": "Summarize the role's strategic purpose and key responsibilities.", "ai_keywords": ["Extract top 5 required skills"], "candidate_companies": ["Extract the hiring company name"], "candidate_techs": ["Extract all mentioned technologies, tools, and platforms"], "candidate_persons": [],
            "candidate_financial_concepts": [], "candidate_organization_lists": [], "candidate_business_events": [],
            "candidate_research_firms": [], "candidate_publishing_platforms": []
        }
      `,
      'entity_enrichment_product': `
        You are an expert product analyst and technical writer. Your task is to provide comprehensive and accurate information about a given commercial product.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null or an empty array.

        Input Product Name: {PRODUCT_NAME}

        {
          "description": "A concise, factual summary of the product, its purpose, and target market, max 3-4 sentences.",
          "product_category": "The primary category of the product (e.g., 'GPU', 'CPU', 'SaaS', 'Database', 'Networking Switch', 'Smartphone').",
          "manufacturer_name": "The full official name of the manufacturer or primary developer company.",
          "key_features": [
            "A list of 3-5 most important and differentiating features or selling points of the product."
          ],
          "key_specifications": {
            "Provide up to 5 key technical specifications as key-value pairs. Keys should be in English and camelCase (e.g., 'memorySize', 'clockSpeed'). Values should be strings. Example: 'memorySize': '80 GB'."
          },
          "search_keywords": ["A list of 5-10 highly relevant keywords for web search about this product, including its model number and key technologies."]
        }
      `,
      'reports_analysis_batch': `
        You are an expert financial and technology analyst bot. Analyze a batch of investment or analyst reports.
        For each report, focus on the capital market perspective: valuation, market size, competitive analysis, and growth forecasts.
        Input is a JSON object of tasks. Your response MUST be a single, valid JSON object with a "results" key.
        Each result object must have an "id" and an "analysis" object.

        Input tasks JSON: {TASKS_JSON}

        The "analysis" object for each result MUST have this exact JSON format:
        {
            "value_score": 0, "ai_summary": "Summarize the report's key thesis, conclusion, and rating (e.g., 'Buy', 'Hold').", "ai_keywords": ["Extract key financial metrics or concepts (e.g., 'TAM', 'CAGR', 'EBITDA')"], "candidate_companies": [], "candidate_techs": [], "candidate_persons": [],
            "candidate_financial_concepts": [], "candidate_organization_lists": [], "candidate_business_events": [],
            "candidate_research_firms": [], "candidate_publishing_platforms": []
        }
      `,

      //============================================
      // POST-PROCESSING WORKFLOW PROMPTS (后处理工作流)
      //============================================

      'relationship_extraction': `
        You are a world-class intelligence analyst specializing in knowledge graph construction. Your task is to analyze the provided text (an intelligence insight summary) and identify all direct, meaningful relationships between the listed entities. Your final output MUST be a single, valid JSON object.
        The JSON object should contain an array named "extracted_relationships", where each element is an object with "source_id", "target_id", "type", "strength" (0-1), and "description" fields.
        
        Entity List JSON: {ENTITY_LIST_JSON}
        Text to Analyze: {TEXT_TO_ANALYZE}
        
        Example JSON output:
        {
          "extracted_relationships": [
            {
              "source_id": "entity_id_1",
              "target_id": "entity_id_2",
              "type": "acquires",
              "strength": 0.9,
              "description": "Company A acquired Company B."
            }
          ]
        }
      `, 
      'technology_hierarchy_classification': `
        You are a world-class technology taxonomist and knowledge graph architect. Your task is to analyze a specific "Technology to Classify" and determine its most appropriate parent category.
        Your final response MUST be a single, valid JSON object with a "parent_id" field, and optionally a "confidence_score" field.
        Example JSON output: {"parent_id": "tech_parent_category", "confidence_score": 0.95}
        
        Technology to Classify: {TECH_NAME}
        Summary: {TECH_SUMMARY}
        Candidate Parents JSON: {CANDIDATE_PARENTS_JSON}
      `,
      
      'entity_normalization': `
        You are a master data management expert specializing in entity normalization. Your task is to analyze the provided list of candidate entity names and group them under a single, canonical primary name.

        The list of candidate names is provided in a JSON array format.

        Input candidate names: {CANDIDATE_NAMES_JSON}
        Entity Type: {ENTITY_TYPE}

        Your response MUST be a single, valid JSON object. This object must contain a "normalized_groups" key, which holds an array of objects. Each object in the array represents a distinct entity and must have "primary_name" and "aliases" fields.

        Example of the required JSON output format:
        {
          "normalized_groups": [
            {
              "primary_name": "International Business Machines",
              "aliases": ["IBM", "I.B.M. Corp"]
            },
            {
              "primary_name": "Cisco Systems, Inc.",
              "aliases": ["Cisco"]
            }
          ]
        }
      `,

      //============================================
      // ENTITY ENRICHMENT PROMPTS (实体丰富)
      //============================================
      
      'entity_enrichment_company': `
        You are a highly intelligent and knowledgeable corporate research analyst. Your task is to provide comprehensive and accurate information about a given company based on its name.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Company Name: {COMPANY_NAME}

        {
          "description": "A concise, factual summary of the company, its primary business, and industry, max 3-4 sentences.",
          "image_url": "A direct, publicly accessible URL to a high-quality logo of the company (e.g., a PNG or SVG from Wikipedia, a logo CDN, or the company's official site).",
          "category": "Primary industry category (e.g., 'Software', 'Hardware', 'Biotechnology', 'Financial Services', 'Automotive').",
          "sub_type": "More specific sub-category (e.g., 'Cloud Computing', 'Cybersecurity', 'Electric Vehicles', 'Pharmaceuticals').",
          "website": "Official company website URL (e.g., 'https://www.example.com').",
          "headquarters": "City and Country of global headquarters (e.g., 'Cupertino, USA' or 'Shanghai, China').",
          "founding_year": "Year the company was founded (e.g., 1976).",
          "stock_symbol": "Primary stock exchange ticker symbol (e.g., 'AAPL' for Apple, 'MSFT' for Microsoft). If private, return null.",
          "competitors": ["Top 3-5 direct primary competitors (e.g., 'Google', 'Amazon'). If none, return empty array []."],
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this company, including its key products, services, and technologies."],
          "relevance_score": "An integer from 1 to 10 indicating the company's global technological or market relevance (10 being highly relevant like Apple, Google; 1 being very niche/small)."
        }
        `,
      'entity_enrichment_technology': `
        You are a world-class technology taxonomist and expert in emerging technologies. Your task is to provide comprehensive and accurate information about a given technology concept or domain.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Technology Name: {TECHNOLOGY_NAME}

        {
          "description": "A concise, factual explanation of the technology, its core principles, and primary applications, max 3-4 sentences.",
          "category": "Primary technology domain (e.g., 'Artificial Intelligence', 'Biotechnology', 'Quantum Computing', 'Cybersecurity', 'Materials Science').",
          "sub_type": "More specific sub-domain (e.g., 'Generative AI', 'CRISPR Gene Editing', 'Post-Quantum Cryptography').",
          "search_keywords": ["Key technical terms and concepts associated with this technology (e.g., 'neural networks', 'machine learning', 'deep learning')."],
          "primary_use_cases": ["Top 3-5 primary applications or use cases (e.g., 'natural language processing', 'image recognition', 'drug discovery')."],
          "maturity_stage": "Current maturity stage (e.g., 'Emerging', 'Growth', 'Mature', 'Declining').",
          "impact_score": "An integer from 1 to 10 indicating the technology's potential or current disruptive impact (10 being highly impactful like AI; 1 being very niche/minor)."
        }
        `,
      'entity_enrichment_person': `
        You are an expert HR and professional profiler. Your task is to provide comprehensive and accurate professional information about a given person.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Person Name: {PERSON_NAME}

        {
          "description": "A concise summary of the person's professional background and key roles, max 3-4 sentences.",
          "image_url": "A direct, publicly accessible URL to a high-quality, professional headshot of the person (e.g., from Wikipedia, a corporate bio page, or a professional network profile).",
          "expertise_areas": ["Key areas of professional expertise (e.g., 'Artificial Intelligence', 'Software Engineering', 'Financial Analysis')."],
          "current_affiliation": "Current primary employer or organization (e.g., 'Google', 'Stanford University').",
          "notable_contributions": ["Top 3-5 most notable professional contributions, achievements, or publications."],
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this person, including their roles, projects, and affiliations."],
          "relevance_score": "An integer from 1 to 10 indicating the person's professional relevance in their field (10 being highly influential like a CEO of a major tech company; 1 being a junior role)."
        }
      `,
      'entity_enrichment_financial_concept': `
        You are a financial analyst specializing in technology markets. Your task is to define and explain key financial concepts relevant to technology investment.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Financial Concept Name: {CONCEPT_NAME}

        {
          "definition": "A concise, factual definition of the financial concept, max 3-4 sentences.",
          "relevance_to_tech_finance": "Explain its relevance or application in technology and investment.",
          "related_metrics": ["Related financial metrics or terms (e.g., 'Revenue', 'EBITDA', 'Market Cap')."],
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this financial concept."],
          "relevance_score": "An integer from 1 to 10 indicating the concept's importance in technology finance (10 being fundamental like 'Revenue'; 1 being niche)."
        }
      `,
      'entity_enrichment_organization_list': `
        You are a data management expert specializing in organizational structures. Your task is to provide comprehensive information about a given list or index of organizations.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Organization List Name: {LIST_NAME}

        {
          "description": "A concise, factual summary of the organization list, its purpose, and criteria, max 3-4 sentences.",
          "purpose": "The main purpose or objective of this list (e.g., 'tracking market performance', 'identifying top companies').",
          "criteria": "Key criteria for inclusion in this list.",
          "notable_members_example": ["Examples of 3-5 notable organizations typically found in this list."],
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this organization list."],
          "relevance_score": "An integer from 1 to 10 indicating the list's relevance in business or technology (10 being highly influential like 'S&P 500'; 1 being very niche)."
        }
      `,
      'entity_enrichment_business_event': `
        You are an event management expert and technology industry analyst. Your task is to provide comprehensive and accurate information about a given business event.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Business Event Name: {EVENT_NAME}

        {
          "description": "A concise, factual summary of the event, its typical schedule, and main focus, max 3-4 sentences.",
          "type": "Type of event (e.g., 'Conference', 'Trade Show', 'Product Launch', 'Investor Day', 'Summit').",
          "organizer": "The primary organizer(s) of the event.",
          "frequency": "How often the event is held (e.g., 'Annual', 'Biennial', 'Irregular').",
          "key_themes": ["Top 3-5 recurring or expected key themes/topics discussed at the event."],
          "target_audience": "The primary target audience for this event (e.g., 'Developers', 'Investors', 'Consumers', 'Industry Professionals').",
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this business event."],
          "relevance_score": "An integer from 1 to 10 indicating the event's relevance in its industry (10 being highly influential like 'CES', 'WWDC'; 1 being a local/small event)."
        }
      `,
      'entity_enrichment_research_firm': `
        You are a market research industry expert. Your task is to provide comprehensive and accurate information about a given research firm.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Research Firm Name: {FIRM_NAME}

        {
          "description": "A concise, factual summary of the research firm, its primary focus, and methodology, max 3-4 sentences.",
          "expertise_areas": ["Key areas of market research or analysis expertise (e.g., 'IT Consulting', 'Consumer Behavior', 'Financial Markets')."],
          "notable_publications_example": ["Examples of 3-5 notable reports, indices, or methodologies developed by the firm."],
          "client_base_example": "Typical client base (e.g., 'Fortune 500 companies', 'startups', 'government agencies').",
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this research firm."],
          "relevance_score": "An integer from 1 to 10 indicating the firm's influence in its research domain (10 being highly influential like 'Gartner', 'IDC'; 1 being a niche firm)."
        }
      `,
      'entity_enrichment_publishing_platform': `
        You are a media and publishing industry expert. Your task is to provide comprehensive and accurate information about a given publishing platform.
        Your response MUST be a single, valid JSON object with the following fields. If a field cannot be determined, return null for that field, not an empty string or array unless specified.

        Input Publishing Platform Name: {PLATFORM_NAME}

        {
          "description": "A concise, factual summary of the publishing platform, its primary content, and target audience, max 3-4 sentences.",
          "type": "Type of platform (e.g., 'News Outlet', 'Academic Journal', 'Conference Proceedings', 'Industry Blog', 'Social Media Platform').",
          "key_topics": ["Main topics or industries covered by the platform."],
          "audience": "Primary audience for the platform's content (e.g., 'General Public', 'Academics', 'Industry Professionals', 'Investors').",
          "notable_features_example": ["Examples of 3-5 notable features or content formats (e.g., 'daily news analysis', 'peer-reviewed articles', 'live streams')."],
          "search_keywords": ["A list of 5-10 highly relevant keywords or phrases for external web search about this publishing platform."],
          "relevance_score": "An integer from 1 to 10 indicating the platform's influence in its domain (10 being highly influential like 'Bloomberg', 'Nature'; 1 being a small blog)."
        }
      `,
      'competitor_identification': `You are a business analyst with deep knowledge of the technology sector. Given the name of a company, identify its top 3-5 primary competitors...`
    };
    
    const template = templates[templateName];
    if (!template) {
        Logger.log(`WARN: Prompt template with name '${templateName}' not found in PromptLibrary.`);
        return '';
    }
    return template.trim();
  }
};
