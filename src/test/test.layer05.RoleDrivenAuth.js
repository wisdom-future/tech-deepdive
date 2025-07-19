/**
 * @file test.layer05.RoleDrivenAuth.js
 * @description [单元测试] 测试认证与授权服务。
 */
function runRoleDrivenAuthTests() {
  return TestRunner.runSuite('Layer 05: Role-Driven Auth', [
    test_L05_A_AuthenticateUser_ActiveAdmin
  ]);
}

function test_L05_A_AuthenticateUser_ActiveAdmin() {
  const originalGetDoc = DataService.getDocument;
  Session.getActiveUser = () => ({ getEmail: () => 'admin@test.com' });
  DataService.getDocument = (key, id) => {
    if (key === 'REG_USERS') return { role_id: 'admin', status: 'active' };
    if (key === 'REG_ROLES') return { allowed_modules: ['all'] };
  };
  const authInfo = AuthService.authenticateUser();
  assert.equal(authInfo.role_id, 'admin', '应认证为admin');
  DataService.getDocument = originalGetDoc;
}
