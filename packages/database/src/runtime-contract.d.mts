export type JboxEnvironment = 'development' | 'preview' | 'production' | 'ci' | 'test';

export declare const ENVIRONMENTS: readonly JboxEnvironment[];
export declare const STAMP_TABLE: '_ascend_environment';

export declare class EnvironmentGuardError extends Error {}

export type EnvironmentRegistry = {
  neonProjectId?: string;
  environments: Record<string, { neonBranchId?: string; endpointIds?: string[] }>;
};

export type DatabaseTarget = {
  hostname: string;
  kind: 'local' | 'neon' | 'other';
  endpointId: string | null;
  pooled: boolean;
};

export declare function isLoopbackHost(hostname: string): boolean;
export declare function describeDatabaseUrl(connectionString: string): DatabaseTarget;
export declare function parseDeclaredEnvironment(value: string | undefined): JboxEnvironment;
export declare function resolveRuntimeEnvironment(env: Record<string, string | undefined>): JboxEnvironment;
export declare function assertToolTarget(options: {
  declared: JboxEnvironment;
  connectionString: string;
  registry: EnvironmentRegistry;
  tool: string;
  allowProduction?: boolean;
}): DatabaseTarget;
export declare function assertRuntimeTarget(options: {
  declared: JboxEnvironment;
  connectionString: string;
  registry: EnvironmentRegistry;
}): DatabaseTarget;
export declare function assertStamp(options: {
  stamp: string | null;
  declared: JboxEnvironment;
  required: boolean;
}): void;
export declare function readStamp(client: {
  query(text: string): Promise<{ rows: Array<Record<string, unknown>> }>;
}): Promise<string | null>;
export declare function pgConnectionConfig(connectionString: string): {
  connectionString: string;
  ssl: false | { rejectUnauthorized: true };
};
export declare function createRuntimeGuard(options: {
  connectionString: string;
  env: Record<string, string | undefined>;
  registry: EnvironmentRegistry;
}): {
  environment: JboxEnvironment;
  config: { connectionString: string; ssl: false | { rejectUnauthorized: true } };
  verifyStamp(client: { query(text: string): Promise<{ rows: Array<Record<string, unknown>> }> }): Promise<void>;
};
