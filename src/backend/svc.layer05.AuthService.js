/**
 * @file layer05.AuthService.js
 * @description [认证与授权层] 负责用户身份验证、角色与权限管理。
 */

const AuthService = {

   /**
    * 验证当前用户身份，并返回包含角色和权限的完整认证信息。
    * @returns {Object} 用户的认证信息对象。
    */
   authenticateUser: function() {
    const userCache = CacheService.getUserCache();
    const userEmail = Session.getActiveUser().getEmail();
    const CACHE_KEY = `auth_info_${userEmail}`;

    // 1. 尝试从缓存中获取认证信息
    const cachedAuthInfo = userCache.get(CACHE_KEY);
    if (cachedAuthInfo) {
      Logger.log(`[AuthService] Cache HIT for user: ${userEmail}`);
      return JSON.parse(cachedAuthInfo);
    }

    Logger.log(`[AuthService] Cache MISS for user: ${userEmail}. Fetching from DB...`);

    // 2. 缓存未命中，执行原始的认证逻辑
    if (!userEmail) {
      const appUrl = ScriptApp.getService().getUrl();
      const loginUrl = `https://accounts.google.com/Login?continue=${encodeURIComponent(appUrl)}`;
      return { error: 'LOGIN_REQUIRED', redirectUrl: loginUrl };
    }

    let userAccount;
    try {
      // ✅ [对齐CONFIG] 使用 'REG_USERS' 键名查询用户账户
      userAccount = DataService.getDocument('REG_USERS', userEmail);
    } catch (e) {
      Logger.log(`[AuthService] Error fetching user account for ${userEmail}: ${e.message}`);
      throw new Error(`认证失败: 无法访问 'REG_USERS' 集合中的文档 '${userEmail}': ${e.message}`);
    }

    let roleId;
    let customTechFocusIds = [];
    let customCompetitorFocusIds = [];

    if (!userAccount || userAccount.status !== 'active') {
      roleId = 'guest'; // 默认角色
    } else {
      roleId = userAccount.role_id;
      customTechFocusIds = userAccount.custom_tech_focus_ids || [];
      customCompetitorFocusIds = userAccount.custom_competitor_focus_ids || [];
    }

    let rolePermissions = this.getRolePermissions(roleId); 
    if (!rolePermissions) {
      Logger.log(`[AuthService] Role '${roleId}' not found. Assigning 'guest' role.`);
      roleId = 'guest';
      rolePermissions = this.getRolePermissions(roleId);
      if (!rolePermissions) {
        throw new Error("Critical: 'guest' role not defined in REG_ROLES.");
      }
    }

    // 计算用户的有效关注点
    const effectiveFocus = {
      focusedTechIds: (rolePermissions.can_override_focus && customTechFocusIds.length > 0) 
                  ? customTechFocusIds 
                  : (rolePermissions.default_tech_focus_ids || []),
      focusedCompetitorIds: (rolePermissions.can_override_focus && customCompetitorFocusIds.length > 0) 
                        ? customCompetitorFocusIds 
                        : (rolePermissions.default_competitor_focus_ids || [])
    };
    
    const authInfo = {
      user_email: userEmail,
      display_name: userAccount ? userAccount.display_name : 'Guest User',
      role_id: roleId,
      effective_focus: effectiveFocus,
      permissions: rolePermissions
    };

    // 3. 将新的认证信息存入缓存
    // 使用 CONFIG 中定义的缓存时间
    userCache.put(CACHE_KEY, JSON.stringify(authInfo), CONFIG.PERFORMANCE.CACHE_DURATION_SECONDS); 
    Logger.log(`[AuthService] Auth info for ${userEmail} stored in cache.`);

    return authInfo;
  },

  /**
   * 根据角色ID获取权限配置。
   * @param {string} roleId - 角色ID。
   * @returns {Object|null} 角色的权限配置对象。
   */
  getRolePermissions: function(roleId) {
    const roleCache = CacheService.getScriptCache();
    const CACHE_KEY = `role_perms_${roleId}`;
    
    const cachedRole = roleCache.get(CACHE_KEY);
    if(cachedRole) {
        return JSON.parse(cachedRole);
    }

    try {
      // ✅ [对齐CONFIG] 使用 'REG_ROLES' 键名查询角色注册表
      const role = DataService.getDocument('REG_ROLES', roleId);
      if (role) {
          roleCache.put(CACHE_KEY, JSON.stringify(role), CONFIG.PERFORMANCE.CACHE_DURATION_SECONDS * 2); // 角色信息变动不频繁，可以缓存更久
      }
      return role || null;
    } catch (e) {
      Logger.log(`[AuthService] Error fetching role permissions for role '${roleId}': ${e.message}`);
      return null;
    }
  },

  /**
   * 检查用户是否有权访问某个模块。
   * @param {string} moduleName - 模块名称。
   * @param {Object} permissions - 用户的权限对象。
   * @returns {boolean}
   */
  getModuleAccess: function(moduleName, permissions) {
    Logger.log(`[AuthService.getModuleAccess] Checking access for module: "${moduleName}"`);
    Logger.log(`[AuthService.getModuleAccess] Received permissions object: ${JSON.stringify(permissions)}`); // 打印收到的权限对象

    if (!permissions || !Array.isArray(permissions.allowed_modules)) {
      Logger.log(`[AuthService.getModuleAccess] Permissions object invalid or allowed_modules is not an array.`);
      return false;
    }
    
    // 假设 'admin' 角色拥有所有模块的访问权限
    // 确保 permissions.role_id 确实是 'admin'
    if (permissions.role_id === 'admin') {
        Logger.log(`[AuthService.getModuleAccess] User has 'admin' role in permissions. Granting access.`);
        return true;
    }
    
    // 如果不是 admin 角色，则检查 allowed_modules 列表
    const hasAccess = permissions.allowed_modules.includes(moduleName);
    Logger.log(`[AuthService.getModuleAccess] User is not 'admin' (role_id: "${permissions.role_id}"). Checking allowed_modules for "${moduleName}". Result: ${hasAccess}. Allowed modules: ${JSON.stringify(permissions.allowed_modules)}`);
    return hasAccess;
  }
};
