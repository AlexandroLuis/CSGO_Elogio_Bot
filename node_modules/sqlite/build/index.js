"use strict";
/// <reference types="./vendor-typings/sqlite3" />
Object.defineProperty(exports, "__esModule", { value: true });
const Statement_1 = require("./Statement");
exports.Statement = Statement_1.Statement;
const Database_1 = require("./Database");
exports.Database = Database_1.Database;
/**
 * Opens a database for manipulation. Most users will call this to get started.
 */
async function open(config) {
    const db = new Database_1.Database(config);
    await db.open();
    return db;
}
exports.open = open;
//# sourceMappingURL=index.js.map