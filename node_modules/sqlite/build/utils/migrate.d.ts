import { Database } from '../Database';
import { IMigrate } from '../interfaces';
import MigrationParams = IMigrate.MigrationParams;
/**
 * Migrates database schema to the latest version
 */
export declare function migrate(db: Database, config?: MigrationParams): Promise<void>;
