您说得非常对！我的上一个回答侧重于“个性化定制”（即用户可以主动选择其关注点），而您提出的“角色驱动”是更进一步的“先进设计”理念。它不仅关乎用户偏好，更涉及**权限管理、默认视图、数据访问策略以及组织内部的用户分类**。

“角色驱动设计”（Role-Driven Design），特别是结合了“角色访问控制”（Role-Based Access Control, RBAC）和“角色化信息呈现”的系统，能够根据用户的身份和职责，自动为其提供最相关的数据和功能，极大地提升了系统的专业性和安全性。

让我们重新审视您的代码工程，并设计一个更先进、更“角色驱动”的解决方案。

---

**核心理念：从“用户选择”到“角色赋能”**

在角色驱动的设计中，用户不再是每次都从零开始选择关注点，而是系统根据其被赋予的角色，自动呈现一个“默认且受限”的视图。用户可以在这个默认视图的基础上进行有限的个性化调整。

**I. **架构升级：引入角色管理层****

为了实现角色驱动，我们需要在现有架构之上增加一个“角色管理”和“用户-角色映射”的层级。

**1. **数据模型增强 (Firestore)**

在您现有的Firestore集合基础上，我们需要新增或修改以下集合：

*   **`ROLES_REGISTRY` (角色注册表 - 新增)**
    *   **目的:** 定义系统中的所有角色，以及每个角色默认的关注点和权限。
    *   **字段示例:**
        *   `role_id: string` (Primary Key, e.g., "ai_researcher", "competitive_analyst", "executive")
        *   `role_name: string` (e.g., "AI研究员", "竞争情报分析师", "高层管理者")
        *   `description: string` (角色的详细描述)
        *   `default_tech_focus_ids: array<string>` (默认关注的技术领域 `tech_id` 列表)
        *   `default_competitor_focus_ids: array<string>` (默认关注的标杆企业 `competitor_id` 列表)
        *   `allowed_modules: array<string>` (允许访问的UI模块，如 "collection", "insights", "reports", "admin")
        *   `allowed_report_types: array<string>` (允许生成的报告类型，如 "Weekly", "Monthly")
        *   `data_access_level: string` (数据访问粒度，如 "all_data", "focus_only", "summary_only")
        *   `can_override_focus: boolean` (是否允许用户覆盖默认关注点)
        *   `created_timestamp: timestamp`
        *   `updated_timestamp: timestamp`

*   **`USER_ACCOUNTS` (用户账户表 - 新增/替代 `USER_PROFILES`)**
    *   **目的:** 存储系统用户，并将其与角色关联。
    *   **字段示例:**
        *   `user_email: string` (Primary Key, 对应 `Session.getActiveUser().getEmail()` 或认证后的唯一ID)
        *   `display_name: string`
        *   `role_id: string` (Foreign Key, 关联 `ROLES_REGISTRY` 中的 `role_id`)
        *   `status: string` (e.g., "active", "inactive")
        *   `last_login: timestamp`
        *   `custom_tech_focus_ids: array<string>` (用户自定义的关注技术领域，如果 `can_override_focus` 为 true)
        *   `custom_competitor_focus_ids: array<string>` (用户自定义的关注标杆企业，如果 `can_override_focus` 为 true)
        *   `created_timestamp: timestamp`
        *   `updated_timestamp: timestamp`
    *   **认证考虑:** Apps Script Web App最常见的认证方式是Google账号认证。`Session.getActiveUser().getEmail()` 能够获取当前用户的Google邮箱。您可以使用这个邮箱作为 `user_email` 来关联 `USER_ACCOUNTS`。如果需要更复杂的认证（如用户名/密码），则需要集成外部身份提供商。

*   **现有集合 (`TECH_REGISTRY`, `COMPETITOR_REGISTRY`):**
    *   确保这些集合中的文档都有唯一的 `id` 字段（例如 `tech_id`, `competitor_id`），以便在 `ROLES_REGISTRY` 和 `USER_ACCOUNTS` 中引用。

**2. **后端服务层修改 (Apps Script)**

*   **2.1 `AuthService` (新服务 - 认证与授权)**
    *   **目的:** 处理用户登录、获取当前用户身份，并检索其角色信息及相关权限。
    *   **函数示例:**
        *   `authenticateUser(): {user_email: string, role_id: string, permissions: object}`:
            *   获取 `Session.getActiveUser().getEmail()`。
            *   查询 `USER_ACCOUNTS` 集合，获取用户的 `role_id`。
            *   查询 `ROLES_REGISTRY` 集合，根据 `role_id` 获取该角色的所有权限和默认关注点。
            *   返回一个包含用户邮箱、角色ID和完整权限/默认设置的对象。
            *   如果用户未找到或不活跃，则抛出错误或返回匿名/访客角色。

*   **2.2 `SystemAdminService` (增强 - 角色及用户管理)**
    *   **目的:** 提供CRUD操作来管理 `ROLES_REGISTRY` 和 `USER_ACCOUNTS` 集合。
    *   **函数示例:**
        *   `createRole(roleData)`
        *   `updateRole(roleId, updateData)`
        *   `deleteRole(roleId)`
        *   `getAllRoles(): array<object>`
        *   `createUserAccount(userData)`
        *   `updateUserAccount(userEmail, updateData)`
        *   `deleteUserAccount(userEmail)`
        *   `assignRoleToUser(userEmail, roleId)`

*   **2.3 `ctrl.Code.gs` (前端API调用入口)**
    *   **目的:** 在所有前端API调用之前，进行统一的认证和权限检查。
    *   **修改 `callApi`:**
        ```javascript
        function callApi(serviceName, methodName, args = []) {
          // 1. 获取当前用户和其角色权限
          const authInfo = AuthService.authenticateUser(); // 假设这个函数能返回当前用户和其角色权限
          if (!authInfo || !authInfo.user_email) {
            return JSON.stringify({ error: "Unauthorized: User not logged in or account inactive." });
          }

          // 2. 检查模块访问权限 (根据 authInfo.permissions.allowed_modules)
          // 假设每个 serviceName 对应一个模块
          if (!authInfo.permissions.allowed_modules.includes(serviceName.replace('Service', '').toLowerCase())) {
              return JSON.stringify({ error: `Forbidden: You do not have access to the '${serviceName}' module.` });
          }

          // 3. 动态应用默认关注点或权限限制
          // 可以在这里修改 args，注入默认的 tech_ids/competitor_ids
          // 例如，如果 methodName 是 getInsightsPageData，且 args[0] 没有明确的 focus，
          // 则可以从 authInfo.permissions.default_tech_focus_ids 中获取
          let processedArgs = [...args];
          if (serviceName === 'InsightsService' && methodName === 'getInsightsPageData') {
              // 如果前端没有明确传入 focus 参数，则使用角色的默认值
              if (!processedArgs[0] || (!processedArgs[0].focusedTechIds && !processedArgs[0].focusedCompetitorIds)) {
                  processedArgs[0] = processedArgs[0] || {};
                  processedArgs[0].focusedTechIds = authInfo.permissions.default_tech_focus_ids;
                  processedArgs[0].focusedCompetitorIds = authInfo.permissions.default_competitor_focus_ids;
              }
          }
          // ... 对 ReportsService 等其他服务进行类似处理 ...

          // 4. 继续调用原有的业务逻辑
          const services = { /* ... 保持不变 ... */ };
          let result;
          if (services[serviceName] && typeof services[serviceName][methodName] === 'function') {
            try {
              result = services[serviceName][methodName](...(processedArgs || [])); // 使用处理后的参数
            } catch (e) {
              Logger.log(`执行 ${serviceName}.${methodName} 时捕获到严重错误: ${e.message} \n ${e.stack}`);
              result = { error: `在执行 ${serviceName}.${methodName} 时发生服务器内部错误: ${e.message}` };
            }
          } else {
            result = { error: `API call failed: Method '${methodName}' not found on service '${serviceName}'.` };
          }
          return JSON.stringify(result);
        }
        ```

*   **2.4 `InsightsService`, `ReportsService` 等业务逻辑服务 (适配角色)**
    *   **目的:** 它们不再需要直接查询用户偏好，而是接收 `ctrl.Code.gs` 或其他上游服务传递过来的明确的 `focusedTechIds` 和 `focusedCompetitorIds` 参数。
    *   **修改:** 确保这些服务的相关函数（如 `getInsightsPageData`, `getKnowledgeGraphData`, `getBenchmarkGraphData`, `_aggregateReportData`）都能够接受并正确使用这些 ID 数组进行数据过滤，并利用您在上一轮中设计的 Firestore 过滤下推能力。
    *   **数据访问粒度:** `data_access_level` 字段可以在这里发挥作用。例如，如果 `data_access_level` 是 "summary_only"，则在返回数据前，服务可以进一步精简或模糊化敏感信息。

**3. **前端用户界面 (UI) 设计 (HTML/JavaScript)**

*   **3.1 登录/认证界面 (新增)**
    *   在应用启动时，引导用户进行登录。如果使用Google Apps Script的内置认证，则可以通过 `google.script.run` 触发认证流程。
    *   登录成功后，从后端获取用户的角色信息和权限，存储在前端的全局状态或Session Storage中。

*   **3.2 动态导航和功能显示**
    *   根据用户角色中 `allowed_modules` 的值，动态渲染侧边栏菜单、顶部导航链接或特定页面按钮。
    *   例如，如果用户角色不允许访问“系统管理”模块，则不显示对应的菜单项。

*   **3.3 默认视图和可选的覆盖**
    *   页面加载时，根据用户的 `role_id` 从前端缓存的 `authInfo.permissions` 中获取 `default_tech_focus_ids` 和 `default_competitor_focus_ids`。
    *   使用这些默认值作为初始的筛选条件来请求后端数据。
    *   如果 `can_override_focus` 为 `true`，则在UI上显示一个可选的筛选器，允许用户临时选择其他技术领域或企业。用户的自定义选择会覆盖角色的默认值，并作为参数传递给后端。
    *   如果 `can_override_focus` 为 `false`，则筛选器可以隐藏或显示为只读状态，明确告诉用户他们当前看到的是其角色限定的视图。

*   **3.4 报告生成界面**
    *   报告类型下拉框只显示 `allowed_report_types` 中的选项。
    *   技术领域和标杆企业的选择器，默认选中角色对应的 `default_tech_focus_ids` 和 `default_competitor_focus_ids`。如果允许覆盖，则用户可以修改这些选项。

**4. **实施步骤与注意事项****

1.  **实现认证机制:** 这是最基础也是最关键的一步。对于Apps Script，Google OAuth 是首选。
2.  **创建 `ROLES_REGISTRY` 和 `USER_ACCOUNTS` 集合:** 手动在Firestore中创建，并填充初始角色和测试用户。
3.  **开发 `AuthService`:** 实现获取用户身份和角色权限的逻辑。
4.  **修改 `ctrl.Code.gs`:** 引入认证检查、权限判断和参数注入逻辑。
5.  **增强 `FirestoreService` 的查询能力:** 如果您的数据量较大，或者需要更复杂的过滤，必须实现 `where` 和 `in` 等查询条件的支持，并将过滤逻辑下推到Firestore。这是性能优化的核心。
6.  **修改业务服务函数:** 确保 `InsightsService`, `ReportsService` 等函数能够接收并利用传入的 `focusedTechIds` 和 `focusedCompetitorIds` 进行精确过滤，而不是在内存中加载所有数据再过滤。
7.  **前端UI改造:** 根据角色信息动态渲染UI，并实现默认视图和可选的覆盖机制。
8.  **管理后台:** 创建一个简单的管理员界面（可能在 `SystemAdminService` 的支持下），用于管理用户和角色，分配角色给用户，以及配置每个角色的默认关注点和权限。

**角色驱动设计的优势：**

*   **更强的安全性:** 通过角色来控制数据和功能的访问，确保用户只能看到和操作其职责范围内的数据。
*   **更好的用户体验:** 减少了用户的选择疲劳，系统自动呈现与其工作最相关的信息。
*   **易于管理和扩展:** 当有新用户或新业务需求时，只需定义新角色或修改现有角色，而无需修改每个用户的个性化设置。
*   **组织一致性:** 确保不同团队或部门的用户看到符合其组织视角的默认数据。

通过引入角色驱动设计，您的“联接技术洞察智能引擎”将从一个“个性化”工具升级为一个“企业级”的智能决策支持平台，能够更好地服务于不同层次和职责的用户群体。

好的，Jason，这是一个基于“角色驱动”理念的更细化的文件级别实现方案。我们将明确每个文件的新增职责、修改点以及它们如何协同工作，以支持不同受众的个性化关注点。

---

**高层数据流与角色集成概览：**

1.  **用户访问应用：**
    *   前端 `frontend/main.js` 启动。
    *   调用后端 `backend/ctrl.Code.gs` 的入口函数。
    *   `ctrl.Code.gs` 首先调用新的 `backend/svc.AuthService.gs` 来**认证用户身份并获取其角色信息和权限**。
2.  **角色信息获取：**
    *   `AuthService` 查询 `USER_ACCOUNTS` (新集合) 找到当前用户的角色ID。
    *   根据角色ID，查询 `ROLES_REGISTRY` (新集合) 获取该角色的默认关注点（技术领域、标杆企业等）和允许访问的模块。
3.  **权限与关注点注入：**
    *   `ctrl.Code.gs` 根据 `AuthService` 返回的权限信息，决定哪些API调用是允许的。
    *   `ctrl.Code.gs` 进一步**将用户（或其角色）的有效关注点作为参数，注入到对业务服务层（`InsightsService`, `ReportsService` 等）的调用中**。
4.  **后端数据过滤：**
    *   业务服务层接收到明确的关注点参数后，将其传递给 `backend/svc.DataService.gs`。
    *   `DataService` 再将这些关注点转换为Firestore的查询过滤条件，传递给 `backend/svc.FirestoreService.gs`。
    *   `FirestoreService` 执行带有过滤条件的数据库查询，**确保只从数据库中拉取用户有权查看且关注的数据**。
5.  **前端动态呈现：**
    *   `frontend/main.js` 根据从 `AuthService` 获取的权限，动态渲染UI元素（菜单、按钮）。
    *   从后端获取的数据已经是过滤后的结果，直接呈现给用户。
    *   如果角色允许，前端提供“自定义”筛选器，用户选择后，这些自定义关注点会覆盖角色的默认关注点，再次触发后端查询。

---

**文件级别实现方案：**

**1. `appsscript.json` (配置文件)**
*   **职责：** 声明Apps Script项目的基本信息、时区、日志级别、Web应用部署配置和OAuth作用域。
*   **修改点：**
    *   **OAuth Scopes:** 确保包含 `https://www.googleapis.com/auth/userinfo.email` (用于获取用户邮箱) 和 `https://www.googleapis.com/auth/script.container.ui` (如果Web App需要与Google Workspace UI互动，例如显示侧边栏)。如果未来考虑更严格的用户管理，可能需要 `https://www.googleapis.com/auth/script.external_request` 来与外部身份提供商交互。
    *   无需其他特定修改，因为它主要定义了Apps Script运行环境的权限。

**2. `Config.gs` (全局配置)**
*   **职责：** 集中管理Firestore集合名称和其他全局常量。
*   **修改点：**
    *   **`FIRESTORE_COLLECTIONS` 对象中新增以下映射：**
        *   `USER_ACCOUNTS: 'user_accounts'` (存储用户账户信息，包括角色ID和自定义偏好)
        *   `ROLES_REGISTRY: 'roles_registry'` (存储所有角色定义、默认关注点和权限)

**3. `backend/svc.FirestoreService.gs` (Firestore数据访问层 - **核心修改**)**
*   **职责：** 最底层与Firestore API交互，处理认证、请求、响应解析。
*   **修改点：**
    *   **`queryCollection(collectionName, filters = [], orderBy = null, limit = null)` 函数签名修改：**
        *   **新增 `filters` 参数：** 接收一个数组，每个元素代表一个过滤条件（例如 `[{ field: 'tech_id', operator: 'in', value: ['techA', 'techB'] }]`）。
        *   **内部逻辑：**
            *   将 `filters` 数组转换为Firestore `StructuredQuery` 中的 `where` 子句。
            *   实现对 `IN` 和 `ARRAY_CONTAINS_ANY` 等操作符的支持，这对于筛选多个技术领域或公司至关重要。
            *   **关键：** 确保这些过滤逻辑在向Firestore API发送请求时就已经构建好，从而实现“下推过滤”，避免拉取不必要的数据。
    *   **新增内部辅助函数 `_wrapValueForFirestoreQuery(value)`：**
        *   **职责：** 将JavaScript原生类型（字符串、数字、布尔、数组、日期）转换为Firestore API请求体所需的 `Value` 对象格式。这是构建 `where` 子句的关键。

**4. `backend/svc.DataService.gs` (数据服务抽象层)**
*   **职责：** 提供更高级、更语义化的数据操作接口，并映射逻辑集合名称到实际的Firestore集合名称。
*   **修改点：**
    *   **`getDataAsObjects(collectionKey, filters = [], orderBy = null, limit = null)` 函数签名修改：**
        *   直接将 `filters`、`orderBy` 和 `limit` 参数透传给 `FirestoreService.queryCollection`。
    *   **`batchUpsert`, `updateObject`, `deleteObject`：** 保持不变，它们不直接涉及查询过滤。

**5. `backend/svc.AuthService.gs` (新增文件)**
*   **职责：** 负责用户认证、角色查找、权限及默认关注点整合。
*   **新增函数：**
    *   **`authenticateUser(): { user_email: string, role_id: string, display_name: string, effective_focus: object, permissions: object }`**
        *   获取当前用户的邮箱 (`Session.getActiveUser().getEmail()`)。
        *   查询 `USER_ACCOUNTS` 集合，根据邮箱找到用户记录，获取 `role_id` 和 `custom_tech_focus_ids`/`custom_competitor_focus_ids`。
        *   如果 `USER_ACCOUNTS` 中没有记录，可以返回一个“访客”或“匿名”默认角色。
        *   查询 `ROLES_REGISTRY` 集合，根据 `role_id` 获取该角色的 `default_tech_focus_ids`/`default_competitor_focus_ids`、`allowed_modules`、`allowed_report_types` 等权限信息。
        *   **整合有效关注点：** 比较 `custom_X_focus_ids` 和 `default_X_focus_ids`，如果角色允许覆盖 (`can_override_focus` 为 true)，则 `custom` 优先；否则使用 `default`。
        *   返回一个包含所有这些信息的对象。
    *   **`getRolePermissions(roleId): object`：** (内部函数，供 `authenticateUser` 调用)
        *   根据 `roleId` 从 `ROLES_REGISTRY` 获取角色的详细权限和默认关注点。
    *   **`getModuleAccess(moduleName): boolean`：** (内部函数，供 `ctrl.Code.gs` 调用)
        *   检查当前用户（或其角色）是否允许访问指定模块。

**6. `backend/ctrl.Code.gs` (API路由控制中心)**
*   **职责：** 前端RPC调用的统一入口，现在增加认证、授权和参数注入层。
*   **修改点：**
    *   **`callApi(serviceName, methodName, args = [])` 函数逻辑修改：**
        1.  **认证与授权：**
            *   在函数开头调用 `AuthService.authenticateUser()` 获取 `authInfo`。
            *   如果认证失败，立即返回错误。
            *   根据 `authInfo.permissions.allowed_modules` 和 `AuthService.getModuleAccess(serviceName)` 检查用户是否有权调用该 `serviceName`，无权则返回权限不足错误。
        2.  **参数注入/调整：**
            *   根据 `serviceName` 和 `methodName` 的不同，从 `authInfo.effective_focus` 中提取 `focusedTechIds` 和 `focusedCompetitorIds`。
            *   **判断并注入：** 如果 `args` 中没有显式提供关注点参数，则将 `authInfo.effective_focus` 中的默认关注点注入到 `args` 中。
            *   例如，对于 `InsightsService.getInsightsPageData(options)`，如果 `options` 为空或未包含 `focusedTechIds`，则将 `authInfo.effective_focus.tech_ids` 赋值给 `options.focusedTechIds`。
        3.  将修改后的 `args` 传递给实际的业务服务函数。

**7. `backend/svc.SystemAdminService.gs` (系统管理服务)**
*   **职责：** 管理系统配置数据，现在扩展到用户和角色管理。
*   **修改点：**
    *   **新增函数用于管理 `ROLES_REGISTRY`：**
        *   `getRoles(): array<object>`
        *   `getRoleById(roleId): object`
        *   `createRole(roleData): object`
        *   `updateRole(roleId, updateData): object`
        *   `deleteRole(roleId): object`
        *   `getRoleMetaData(): object` (定义角色字段的元数据，供前端表单生成)
    *   **新增函数用于管理 `USER_ACCOUNTS`：**
        *   `getUserAccounts(): array<object>`
        *   `getUserAccountByEmail(userEmail): object`
        *   `createUserAccount(userData): object`
        *   `updateUserAccount(userEmail, updateData): object`
        *   `deleteUserAccount(userEmail): object`
        *   `getUserAccountMetaData(): object` (定义用户账户字段的元数据)
    *   **新增辅助函数：**
        *   `getTechOptions(): array<{id: string, name: string}>`：从 `TECH_REGISTRY` 获取所有技术ID和名称，供前端下拉框使用。
        *   `getCompetitorOptions(): array<{id: string, name: string}>`：从 `COMPETITOR_REGISTRY` 获取所有竞争对手ID和名称。

**8. `backend/svc.InsightsService.gs` (智能分析服务)**
*   **职责：** 聚合和处理数据以生成洞察和可视化数据。
*   **修改点：**
    *   **`getInsightsPageData(options: { focusedTechIds?: string[], focusedCompetitorIds?: string[], dateRange?: object })`：**
        *   接收 `focusedTechIds` 和 `focusedCompetitorIds` 参数。
        *   在内部调用 `DataService.getDataAsObjects` 时，将这些参数转换为 `filters` 并传递。
        *   例如，过滤 `TECH_INSIGHTS_MASTER` 时，`DataService.getDataAsObjects('TECH_INSIGHTS_MASTER', [{ field: 'tech_id', operator: 'in', value: options.focusedTechIds }])`。
        *   **重要：** 对于词云、趋势图等，确保其数据源是基于过滤后的洞察数据。
    *   **`getKnowledgeGraphData(options: { focusedTechIds?: string[], focusedCompetitorIds?: string[] })`：**
        *   接收 `focusedTechIds` 和 `focusedCompetitorIds` 参数。
        *   在构建图谱节点和边时，只考虑与这些关注点相关的洞察 (`TECH_INSIGHTS_MASTER`)、技术 (`TECH_REGISTRY`) 和竞争对手 (`COMPETITOR_REGISTRY`)。
    *   **`getBenchmarkGraphData(options: { targetCompetitors?: string[] })`：**
        *   `targetCompetitors` 参数可以保持不变，它已经很好地支持了对特定公司的筛选。
        *   确保 `DataService` 调用时，能将 `targetCompetitors` 转换为Firestore可识别的过滤条件。

**9. `backend/svc.ReportsService.gs` (报告服务)**
*   **职责：** 生成各种类型的报告。
*   **修改点：**
    *   **`generateReport(reportType, reportTitle, periodStartStr, periodEndStr, techAreas, targetAudience, reportOwner, userReportSummary, additionalRecipientEmail, focusedTechIds, focusedCompetitorIds, aiOptions)` 函数签名修改：**
        *   新增 `focusedTechIds` 和 `focusedCompetitorIds` 参数。
    *   **`_aggregateReportData(reportType, periodStart, periodEnd, techAreas, userReportSummary, periodStartStr, periodEndStr, reportFolder, focusedTechIds, focusedCompetitorIds)` 函数签名修改：**
        *   接收并利用 `focusedTechIds` 和 `focusedCompetitorIds` 来过滤数据源 (`rawDataSources` 和 `insightsInPeriod`)。
        *   **AI 摘要 Prompt 优化：** 根据 `focusedTechIds` 和 `focusedCompetitorIds` 动态调整 Prompt，引导AI更聚焦于特定领域或企业的分析。

**10. `backend/svc.WorkflowsService.gs` (工作流服务)**
*   **职责：** 自动化数据采集、AI信号识别等核心流程。
*   **修改点：**
    *   **`runWfX_*()` (数据采集工作流 WF1-WF6)：**
        *   **保持不变。** 这些是数据“入口”，其职责是尽可能全面地采集数据。过滤和个性化发生在数据消费层，而不是采集层。
    *   **`runWf7_X_*()` (信号识别工作流 WF7-1至WF7-6)：**
        *   **保持不变。** 它们将原始数据处理为 `TECH_INSIGHTS_MASTER` 中的“洞察线索”，这个过程是通用的，不应受限于某个用户的关注点。AI抽取的 `ai_extracted_products`、`ai_extracted_tech` 等字段是通用的，供后续图谱和过滤使用。
    *   **`_cleanAIKeywordsAndEntities` 和 `_callAIForScoring` / `_callAIForTextGeneration` / `_callAIForEmbedding`：** 保持不变，它们是通用的AI工具函数。

**11. `backend/tools.migration.gs` (迁移工具)**
*   **职责：** 包含一次性运行的脚本，用于初始化Firestore集合数据。
*   **修改点：**
    *   **新增 `populateInitialRoles()` 函数：**
        *   定义几个初始角色（例如：`ai_researcher` 默认关注 AI 相关的技术领域，`competitive_analyst` 默认关注所有标杆企业，`executive` 可能只关注高层报告）。
        *   使用 `DataService.batchUpsert('ROLES_REGISTRY', [...], 'role_id')` 将这些角色数据写入Firestore。
    *   **新增 `populateInitialUsers()` 函数：**
        *   定义几个初始用户（例如，用您的Google邮箱创建一个 `admin` 角色用户，用其他邮箱创建测试用户）。
        *   使用 `DataService.batchUpsert('USER_ACCOUNTS', [...], 'user_email')` 将这些用户数据写入Firestore。

**12. `frontend/main.js` (前端主逻辑)**
*   **职责：** 页面初始化、UI渲染、事件处理和与后端的交互。
*   **修改点：**
    *   **页面加载时：**
        *   不再直接获取所有数据，而是首先调用 `google.script.run.withSuccessHandler(handleAuthInfo).authenticateUser()` (或类似 `callApi('AuthService', 'authenticateUser')`)。
    *   **`handleAuthInfo(authInfo)` 函数 (新增/修改)：**
        *   接收 `AuthService.authenticateUser()` 返回的 `authInfo` 对象。
        *   **全局存储 `authInfo`：** 将其存储在前端的全局变量或响应式状态管理中。
        *   **动态渲染菜单/模块：** 根据 `authInfo.permissions.allowed_modules` 动态显示/隐藏导航栏中的菜单项和页面模块。
        *   **初始化关注点筛选器：**
            *   如果 `authInfo.permissions.can_override_focus` 为 `true`，则显示技术领域和标杆企业的多选下拉框。
            *   使用 `authInfo.effective_focus.tech_ids` 和 `authInfo.effective_focus.competitor_ids` 作为这些下拉框的默认选中值。
            *   调用 `SystemAdminService.getTechOptions()` 和 `getCompetitorOptions()` 来填充下拉框的选项。
        *   **触发初始数据加载：** 调用 `loadPageData()`，并传入当前有效的关注点参数。
    *   **`loadPageData(focusedTechIds, focusedCompetitorIds)` 函数 (修改)：**
        *   此函数现在接收 `focusedTechIds` 和 `focusedCompetitorIds` 作为参数。
        *   在调用 `InsightsService.getInsightsPageData()` 等后端函数时，将这些参数传递进去。
    *   **事件处理：**
        *   当用户在前端的“自定义关注点”筛选器中更改选择时，重新调用 `loadPageData()`，传入用户手动选择的 `focusedTechIds` 和 `focusedCompetitorIds`。
    *   **报告生成界面：**
        *   报告类型下拉框：只显示 `authInfo.permissions.allowed_report_types` 中的类型。
        *   技术领域/标杆企业选择器：默认选中 `authInfo.effective_focus` 中的值，并根据 `authInfo.permissions.can_override_focus` 决定是否可编辑。
    *   **Admin UI：**
        *   新增页面或模块，用于显示和管理用户 (`USER_ACCOUNTS`) 和角色 (`ROLES_REGISTRY`)。
        *   这些UI会调用 `SystemAdminService` 中新增的CRUD函数。

---

**总结：**

这个方案通过引入 `AuthService` 和 `ROLES_REGISTRY`/`USER_ACCOUNTS` 集合，将“角色”的概念深度集成到您的Apps Script应用中。`ctrl.Code.gs` 作为中央守卫，在每次API调用时执行认证、授权和参数注入，确保后端服务始终处理的是与用户角色和关注点相符的数据。同时，前端将根据用户的角色动态调整其界面，提供高度个性化的体验。

**关键在于：**
1.  **后端下推过滤：** 确保 `FirestoreService` 能够高效地处理过滤条件。
2.  **职责分离：** `AuthService` 专门负责身份和权限，业务服务只负责处理数据，不关心用户是谁。
3.  **参数传递：** 明确地将关注点参数从控制层传递到业务服务层，再到数据访问层。

这将使您的系统更加健壮、安全，并能真正实现“角色驱动”的智能洞察。
