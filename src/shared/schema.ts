export type Dialect = 'postgres' | 'mysql' | 'sqlite' | 'mssql' | 'demo';

export type SshConfig = {
    host: string;
    port: number;
    user: string;
    password: string;
};

export type ConnectionConfig =
    | {
        dialect: 'postgres' | 'mysql' | 'mssql';
        host: string;
        port: number;
        user: string;
        password: string;
        database: string;
        ssl?: boolean;
        ssh?: SshConfig;
    }
    | { dialect: 'sqlite'; file: string }
    | { dialect: 'demo' };

export type ColumnMeta = {
    name: string;
    dataType: string;
    nullable: boolean;
    isPrimaryKey: boolean;
    isUnique: boolean;
    default: string | null;
    comment: string | null;
};

export type IndexMeta = {
    name: string;
    columns: string[];
    type?: string;
};

export type ForeignKey = {
    columns: string[];
    refSchema: string | null;
    refTable: string;
    refColumns: string[];
    onDelete?: string;
    onUpdate?: string;
};

export type TableRef = {
    schema: string | null;
    name: string;
};

export type TableSchema = TableRef & {
    columns: ColumnMeta[];
    foreignKeys: ForeignKey[];
    referencedBy: ForeignKey[];
    uniqueConstraints: string[][];
    indexes: IndexMeta[];
};

export type DiagramPayload = {
    tables: TableSchema[];
    rootKey?: string;
};
