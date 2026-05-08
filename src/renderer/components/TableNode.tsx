import { Handle, Position } from '@xyflow/react';
import type { NodeProps, Node } from '@xyflow/react';
import type { ColumnMeta } from '@shared/schema';

export type TableNodeData = {
  schema: string | null;
  name: string;
  columns: ColumnMeta[];
  fkColumns: Set<string>;
  isRoot: boolean;
};

export type TableNodeType = Node<TableNodeData, 'table'>;

export default function TableNode({ data }: NodeProps<TableNodeType>) {
  return (
    <div className={`table-node ${data.isRoot ? 'root' : ''}`}>
      <div className="table-header">
        {data.schema && <span className="schema">{data.schema}.</span>}
        <span className="name">{data.name}</span>
      </div>
      <ul className="columns">
        {data.columns.map((c) => (
          <li key={c.name} className="column">
            <Handle
              type="target"
              position={Position.Left}
              id={`${c.name}-l`}
              className="col-handle"
            />
            <span className="col-name">
              {c.isPrimaryKey && <span className="badge pk" title="Primary key">PK</span>}
              {data.fkColumns.has(c.name) && <span className="badge fk" title="Foreign key">FK</span>}
              {c.name}
            </span>
            <span className="col-type">
              {c.dataType}
              {c.nullable ? '' : ' NOT NULL'}
            </span>
            <Handle
              type="source"
              position={Position.Right}
              id={`${c.name}-r`}
              className="col-handle"
            />
          </li>
        ))}
      </ul>
    </div>
  );
}
