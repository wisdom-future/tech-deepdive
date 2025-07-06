// 文件名: backend/migration_utils.gs (版本 2.0 - 自动生成ID并回填)

/**
 * 辅助函数：从指定的 Google Sheet 中读取数据。
 * 假定工作表的第一行包含英文标头（用作对象键），第二行包含中文标签。
 * @param {string} spreadsheetId Google Spreadsheet 的 ID。
 * @param {string} sheetName Google Spreadsheet 中工作表的名称。
 * @returns {Array<Object>} 包含数据行的对象数组。
 * @throws {Error} 如果找不到电子表格或工作表。
 */
function _readDataFromSpecificSheet(spreadsheetId, sheetName) {
  Logger.log(`尝试从 Spreadsheet ID: ${spreadsheetId}, Sheet Name: ${sheetName} 读取数据`);
  const ss = SpreadsheetApp.openById(spreadsheetId);
  const sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw new Error(`在 Spreadsheet ID '${spreadsheetId}' 中找不到名为 '${sheetName}' 的工作表。请确保工作表存在且命名正确。`);
  }
  const range = sheet.getDataRange();
  const values = range.getValues();

  if (values.length < 2) {
    Logger.log(`工作表 '${sheetName}' 中除了标题行外没有找到数据行。`);
    return [];
  }

  const headers = values[0];
  const dataRows = values.slice(2);

  const objects = dataRows.map(row => {
    const obj = {};
    headers.forEach((header, index) => {
      let value = row[index];
      if (header.includes('date') || header.includes('timestamp')) {
        obj[header] = (value && !isNaN(new Date(value).getTime())) ? new Date(value) : null;
      } else if (typeof value === 'string' && (value.toLowerCase() === 'true' || value.toLowerCase() === 'false')) {
        obj[header] = value.toLowerCase() === 'true';
      } else if (['founded_year', 'employee_count', 'annual_revenue', 'monitoring_priority'].includes(header)) {
          if (typeof value === 'number') {
              obj[header] = value;
          } else if (typeof value === 'string' && value.trim() !== '') {
              const numValue = Number(value);
              obj[header] = isNaN(numValue) ? null : numValue;
          } else {
              obj[header] = null;
          }
      } else if (value === "") {
        obj[header] = null;
      } else {
        obj[header] = value;
      }
    });
    return obj;
  });
  Logger.log(`成功从工作表 '${sheetName}' 读取了 ${objects.length} 行数据。`);
  return objects;
}

/**
 * 从 Google Sheet 中的数据重新生成指定的 Firestore 集合。
 * 此函数首先清空 Firestore 中的目标集合以确保幂等性，
 * 然后从指定的工作表中读取数据并进行批量更新（upsert）。
 * @param {string} spreadsheetId 包含源数据的 Google Spreadsheet 的 ID。
 * @param {string} sheetName Google Spreadsheet 中工作表的名称（例如，“业界标杆”）。
 * @param {string} firestoreCollectionKey Firestore 集合的键（例如，“COMPETITOR_REGISTRY”），在 CONFIG.FIRESTORE_COLLECTIONS 中定义。
 * @param {string} idField 用作 Firestore 中文档 ID 的字段名（例如，“competitor_id”）。
 * @param {string|null} [idPrefix=null] - 结构化ID的前缀，如 'COMP'。如果提供，将启用ID自动生成。
 * @returns {Object} 包含成功状态和消息的结果对象。
 */
function _regenerateFirestoreCollectionFromSheet(spreadsheetId, sheetName, firestoreCollectionKey, idField, idPrefix = null) {
  Logger.log(`--- 开始为 Firestore 集合: ${firestoreCollectionKey} 从工作表: ${sheetName} 进行数据再生 ---`);
  try {
    const collectionName = CONFIG.FIRESTORE_COLLECTIONS[firestoreCollectionKey];
    if (!collectionName) {
      throw new Error(`在 CONFIG.FIRESTORE_COLLECTIONS 中找不到 Firestore 集合键 '${firestoreCollectionKey}'。`);
    }

    // 步骤 1: 清空 Firestore 中现有数据
    Logger.log(`正在清空 Firestore 集合: ${collectionName}...`);
    FirestoreService.deleteCollection(collectionName);
    Utilities.sleep(2000);

    // 步骤 2: 从 Google Sheet 读取数据
    const allObjects = _readDataFromSpecificSheet(spreadsheetId, sheetName);
    if (!allObjects || allObjects.length === 0) {
      Logger.log(`在工作表 '${sheetName}' 中未找到数据，跳过导入 Firestore。`);
      return { success: true, message: `集合 '${collectionName}' 已清空。工作表中没有数据可导入。` };
    }

    // <<-- 新增逻辑：如果需要，为缺少ID的行生成ID -->>
    if (idPrefix) {
      let idCounter = 0;
      // 找到当前最大的ID后缀数字，以避免冲突
      const maxIdNum = allObjects.reduce((max, obj) => {
        const id = obj[idField];
        if (id && String(id).startsWith(idPrefix)) {
          const num = parseInt(String(id).replace(idPrefix, ''), 10);
          if (!isNaN(num) && num > max) {
            return num;
          }
        }
        return max;
      }, 0);
      idCounter = maxIdNum;
      Logger.log(`  - ID生成器初始化：前缀 '${idPrefix}', 起始计数器为 ${idCounter}.`);

      // 遍历并填充缺失的ID
      allObjects.forEach(obj => {
        // 关键检查：如果 idField 对应的单元格为空或未定义
        if (!obj[idField]) {
          idCounter++;
          const newId = `${idPrefix}${String(idCounter).padStart(3, '0')}`;
          obj[idField] = newId; // 关键：将新ID赋值回对象
          Logger.log(`  - 为记录 '${obj.company_name || obj.conference_name || '未知记录'}' 生成了新ID: ${newId}`);
        }
      });
    }

    // 步骤 3: 批量更新数据到 Firestore
    Logger.log(`正在将 ${allObjects.length} 条记录批量更新到 Firestore 集合: ${collectionName}...`);
    DataService.batchUpsert(firestoreCollectionKey, allObjects, idField);

    Logger.log(`--- 成功再生 Firestore 集合: ${firestoreCollectionKey} ---`);
    return { success: true, message: `成功为 ${collectionName} 再生了 ${allObjects.length} 条记录。` };

  } catch (e) {
    Logger.log(`再生 ${firestoreCollectionKey} 期间发生错误: ${e.message}\n${e.stack}`);
    return { success: false, message: `未能再生 ${firestoreCollectionKey}: ${e.message}` };
  }
}

/**
 * 主函数：再生关键的 Firestore 注册表。
 * 包括：
 * - COMPETITOR_REGISTRY (业界标杆)
 * - CONFERENCE_REGISTRY (学术顶会)
 *
 * 在运行此函数之前，请务必：
 * 1. 确保 'TechInsight_Config_DB.xlsx' 文件已上传到 Google Drive，并已转换为 Google Sheets 格式。
 * 2. 从 Google Sheet 的 URL 中获取其 Spreadsheet ID。
 * 3. 确保该电子表格中的工作表名称与代码中指定的名称完全一致。
 * 4. 将 'YOUR_GOOGLE_SHEET_ID_HERE' 替换为您的实际 Spreadsheet ID。
 */
function regenerateCriticalRegistries() {
  Logger.log("======== 开始再生关键注册表数据 ========");

  const GOOGLE_SHEET_ID = '14jCzQclmFaHRH8iHrYt9v2Tk-bZ8TVrvbhXUZyFITNE'; // 替换为您的实际 ID

  if (GOOGLE_SHEET_ID === 'YOUR_GOOGLE_SHEET_ID_HERE' || !GOOGLE_SHEET_ID) {
    Logger.log("错误：Google Sheet ID 未配置。请在脚本中更新 'GOOGLE_SHEET_ID'。");
    return { success: false, message: "Google Sheet ID 未配置。" };
  }

  let results = [];

  // 再生 COMPETITOR_REGISTRY (业界标杆)
  Logger.log("\n尝试再生 COMPETITOR_REGISTRY (业界标杆)...");
  const competitorResult = _regenerateFirestoreCollectionFromSheet(
    GOOGLE_SHEET_ID,
    "Competitor_Registry",
    "COMPETITOR_REGISTRY",
    "competitor_id",
    "COMP" // <<-- 传递ID前缀
  );
  results.push(competitorResult);
  Logger.log(`COMPETITOR_REGISTRY 结果: ${competitorResult.message}`);

  // 再生 CONFERENCE_REGISTRY (学术顶会)
  Logger.log("\n尝试再生 CONFERENCE_REGISTRY (学术顶会)...");
  const conferenceResult = _regenerateFirestoreCollectionFromSheet(
    GOOGLE_SHEET_ID,
    "Conference_Registry",
    "CONFERENCE_REGISTRY",
    "conference_id",
    "CONF" // <<-- 传递ID前缀
  );
  results.push(conferenceResult);
  Logger.log(`CONFERENCE_REGISTRY 结果: ${conferenceResult.message}`);

  Logger.log("\n======== 关键注册表数据再生完成 ========");
  results.forEach(res => Logger.log(res.message));
  return results;
}
