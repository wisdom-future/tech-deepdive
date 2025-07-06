// 文件名: backend/lib_FirestoreApp.gs @20250702

/**
 *
 * FirestoreApp Library (v1.9.2 - MODIFIED FOR DIRECT INSTANTIATION)
 *
 * @author Grahamearley
 *  https://github.com/grahamearley/FirestoreGoogleAppsScript
 *
 * @license MIT
 *
 * @see {@link https://github.com/grahamearley/FirestoreGoogleAppsScript|The GitHub project page}
 *
 */

// ✅ 核心改造：将整个库封装在一个名为 FirestoreApp 的类中
class FirestoreApp {
  /**
   * Get a Firestore instance
   *
   * @param {string} email the user email
   * @param {string} key the user private key
   * @param {string} projectId the user project id
   * @param {string} [databaseId] the user database id
   * @return {Firestore} the Firestore instance
   */
  getFirestore(email, key, projectId, databaseId) {
    return new Firestore(email, key, projectId, databaseId);
  }
}


/****************************************************************
 * Firestore
 ****************************************************************/
// ... (从这里开始，到文件末尾的所有其他类和函数的代码，保持原样，无需改动)
// ... 我将把它们全部粘贴在下面，以确保文件的完整性
/****************************************************************
 * Firestore
 ****************************************************************/

/**
 * The class for the Firestore instance
 *
 * @class Firestore
 */
class Firestore {
  /**
   * @param {string} email the user email
   * @param {string} key the user private key
   * @param {string} projectId the user project id
   * @param {string} [databaseId="(default)"] the user database id
   */
  constructor(email, key, projectId, databaseId = "(default)") {
    this.email = email;
    this.key = key;
    this.projectId = projectId;
    this.databaseId = databaseId;

    this.url = "https://firestore.googleapis.com/v1/projects/" + this.projectId + "/databases/" + this.databaseId + "/documents";
  }

  /**
   * Gets a Google Cloud service
   *
   * @return {object} the Google Cloud service
   */
  getService() {
    return OAuth2.createService("Firestore")
      .setTokenUrl("https://accounts.google.com/o/oauth2/token")
      .setPrivateKey(this.key)
      .setIssuer(this.email)
      .setSubject(this.email)
      .setPropertyStore(PropertiesService.getScriptProperties())
      .setScope("https://www.googleapis.com/auth/datastore");
  }

  /**
   * Get the authorization token
   *
   * @return {string} the authorization token
   */
  getAuthToken() {
    const service = this.getService();
    if (service.hasAccess()) {
      return service.getAccessToken();
    } else {
      throw new Error("Firestore Authorization Error: " + service.getLastError());
    }
  }

  /**
   * Resets authorization
   *
   * @return {void}
   */
  reset() {
    const service = this.getService();
    service.reset();
  }

  /**
   * Auto-generates a new document ID
   *
   * @return {string} the new document ID
   */
  autoId() {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let autoId = '';
    for (let i = 0; i < 20; i++) {
      autoId += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return autoId;
  };

  /**
   * Get a document
   *
   * @param {string} path the path to the document
   * @return {object} the document object
   */
  getDocument(path) {
    const fullPath = this.url + "/" + path;
    return new Document(fullPath, this.getAuthToken());
  }

  /**
   * Get a document reference
   *
   * @param {string} path the path to the document
   * @return {object} the document reference object
   */
  getDocumentReference(path) {
    return {
      "name": "projects/" + this.projectId + "/databases/" + this.databaseId + "/documents/" + path
    }
  }

  /**
   * Get all documents from a collection
   *
   * @param {string} path the path to the collection
   * @param {number} [pageSize] the number of documents per page
   * @return {object[]} an array of document objects
   */
  getDocuments(path, pageSize) {
    const response = this.request(this.url + "/" + path, "get", {
      "pageSize": pageSize
    });
    const documents = response.documents.map(doc => {
      const document = new Document(doc.name, this.getAuthToken());
      document.obj = document.convert(doc);
      return document;
    });
    return documents;
  }

  /**
   * Create a document
   *
   * @param {string} path the path to the document
   * @param {object} fields the document's fields
   * @return {object} the document object
   */
  createDocument(path, fields) {
    const documentId = path.includes('/') ? path.substring(path.lastIndexOf('/') + 1) : path;
    const document = this.getDocument(path);
    document.obj = document.create(fields, documentId);
    return document;
  }

  /**
   * Update a document
   *
   * @param {string} path the path to the document
   * @param {object} fields the document's fields
   * @param {boolean} [mask=false] whether to mask the fields
   * @return {object} the document object
   */
  updateDocument(path, fields, mask) {
    const document = this.getDocument(path);
    document.obj = document.update(fields, mask);
    return document;
  }

  /**
   * Delete a document
   *
   * @param {string} path the path to the document
   * @return {object} the response object
   */
  deleteDocument(path) {
    return this.request(this.url + "/" + path, "delete");
  }

  /**
   * Get a query builder
   *
   * @param {string} [path] the path to the collection
   * @return {object} the query builder
   */
  query(path) {
    return new Query(this, path);
  }

  /**
   * Run a query
   *
   * @param {object} query the query object
   * @return {object[]} an array of document objects
   */
  runQuery(query) {
    const response = this.request(this.url.substring(0, this.url.lastIndexOf('/')), "post", {
      "structuredQuery": query
    });
    const documents = response.map(res => {
      const document = new Document(res.document.name, this.getAuthToken());
      document.obj = document.convert(res.document);
      return document;
    });
    return documents;
  }

  /**
   * Make a batch request
   *
   * @param {object[]} documents the array of document objects
   * @param {function} func the function to be applied to each document
   * @return {object} the response object
   */
  batch(documents, func) {
    const writes = documents.map(doc => {
      const writer = {};
      writer.update = writer.create = writer.delete = () => {}; // dummy functions
      func(doc, writer);
      return writer.write;
    });
    return this.request(this.url + ":commit", "post", {
      "writes": writes
    });
  }

  /**
   * Make a request to the Firestore API
   *
   * @param {string} url the url to send the request to
   * @param {string} [method="get"] the request method
   * @param {object} [payload] the request payload
   * @return {object} the response object
   */
  request(url, method = "get", payload) {
    const options = {
      "method": method,
      "headers": {
        "Authorization": "Bearer " + this.getAuthToken()
      },
      "contentType": "application/json",
      "muteHttpExceptions": true
    };
    if (payload) {
      options.payload = JSON.stringify(payload);
    }
    const response = UrlFetchApp.fetch(url, options);
    const responseObj = JSON.parse(response.getContentText());
    if (response.getResponseCode() >= 400) {
      const error = responseObj.error;
      throw new Error(`${error.status}: ${error.message} \n ${JSON.stringify(error.details)}`);
    }
    return responseObj;
  }
}

class Document {
  constructor(path, authToken) {
    this.path = path;
    this.authToken = authToken;
    this.obj = this.get();
  }
  request(method = "get", payload) {
    const firestore = new Firestore();
    firestore.getAuthToken = () => this.authToken;
    return firestore.request(this.path, method, payload);
  }
  get() {
    try {
      const response = this.request();
      return this.convert(response);
    } catch (e) {
      if (e.message.includes("NOT_FOUND")) {
        return undefined;
      }
      throw e;
    }
  }
  create(fields, documentId) {
    const firestore = new Firestore();
    const payload = firestore.create(fields);
    let url = this.path;
    if (documentId) {
      url += "?documentId=" + documentId;
    }
    const response = this.request("post", payload);
    this.path = response.name;
    return this.convert(response);
  }
  update(fields, mask) {
    const firestore = new Firestore();
    const payload = firestore.create(fields);
    let url = this.path;
    if (mask) {
      const maskFields = Object.keys(fields).map(field => `updateMask.fieldPaths=${field}`);
      url += `?${maskFields.join('&')}`;
    }
    const response = this.request("patch", payload);
    return this.convert(response);
  }
  delete() {
    return this.request("delete");
  }
  convert(firestoreObject) {
    const obj = {};
    obj.name = firestoreObject.name;
    obj.createTime = firestoreObject.createTime;
    obj.updateTime = firestoreObject.updateTime;
    const fields = new Firestore().unwrap(firestoreObject.fields);
    Object.assign(obj, fields);
    return obj;
  }
}

class Query {
  constructor(firestore, path) {
    this.firestore = firestore;
    this.query = {};
    if (path) {
      this.query.from = [{
        "collectionId": path
      }];
    }
  }
  select(fields) {
    this.query.select = { "fields": fields.map(field => ({"fieldPath": field})) };
    return this;
  }
  where(field, operator, value) {
    if (!this.query.where) {
      this.query.where = { "compositeFilter": { "op": "AND", "filters": [] } };
    }
    this.query.where.compositeFilter.filters.push({ "fieldFilter": { "field": { "fieldPath": field }, "op": operator, "value": this.firestore.wrap(value) } });
    return this;
  }
  orderBy(field, direction) {
    if (!this.query.orderBy) {
      this.query.orderBy = [];
    }
    this.query.orderBy.push({ "field": { "fieldPath": field }, "direction": direction || "ASCENDING" });
    return this;
  }
  limit(limit) {
    this.query.limit = limit;
    return this;
  }
  offset(offset) {
    this.query.offset = offset;
    return this;
  }
  run() {
    return this.firestore.runQuery(this.query);
  }
  count() {
    return this.firestore.runQuery(this.query, true);
  }
}

Firestore.prototype.wrap = function(object) {
  const type = typeof object;
  if (object === null) { return { "nullValue": null } }
  if (type === "string") { return { "stringValue": object } }
  if (type === "boolean") { return { "booleanValue": object } }
  if (type === "number") {
    if (object % 1 === 0) { return { "integerValue": object } } else { return { "doubleValue": object } }
  }
  if (type === "object") {
    if (object instanceof Date) { return { "timestampValue": object.toISOString() } }
    if (Array.isArray(object)) { return { "arrayValue": { "values": object.map(value => this.wrap(value)) } } }
    if (object.latitude && object.longitude) { return { "geoPointValue": { "latitude": object.latitude, "longitude": object.longitude } } }
    if (object.name && object.name.includes("/documents/")) { return { "referenceValue": object.name } }
    return { "mapValue": { "fields": this.create(object).fields } }
  }
}

Firestore.prototype.unwrap = function(object) {
  const unwrapped = {};
  for (const key in object) {
    const value = object[key];
    const valueType = Object.keys(value)[0];
    let unwrappedValue;
    switch (valueType) {
      case "stringValue": case "booleanValue": case "integerValue": case "doubleValue": case "timestampValue": case "referenceValue": case "geoPointValue":
        unwrappedValue = value[valueType];
        break;
      case "nullValue":
        unwrappedValue = null;
        break;
      case "arrayValue":
        unwrappedValue = value.arrayValue.values.map(v => this.unwrap({ v }).v);
        break;
      case "mapValue":
        unwrappedValue = this.unwrap(value.mapValue.fields);
        break;
      default:
        unwrappedValue = value;
        break;
    }
    unwrapped[key] = unwrappedValue;
  }
  return unwrapped;
}

Firestore.prototype.create = function(object) {
  const fields = {};
  for (const key in object) {
    fields[key] = this.wrap(object[key]);
  }
  return { "fields": fields };
}
