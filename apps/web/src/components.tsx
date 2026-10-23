import { Tag } from 'antd';
import {
  statusLabels,
  typeLabels,
  type ApplicationType,
} from '../../../packages/contracts/src/index.js';
export function Icon({ name, size = 20 }: { name: string; size?: number }) {
  const paths: Record<string, React.ReactNode> = {
    grid: (
      <>
        <rect x="3" y="3" width="7" height="7" rx="1.5" />
        <rect x="14" y="3" width="7" height="7" rx="1.5" />
        <rect x="3" y="14" width="7" height="7" rx="1.5" />
        <rect x="14" y="14" width="7" height="7" rx="1.5" />
      </>
    ),
    file: (
      <>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
        <path d="M14 2v6h6M8 13h8M8 17h5" />
      </>
    ),
    check: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="5" />
        <path d="m7 12 3 3 7-7" />
      </>
    ),
    flow: (
      <>
        <rect x="8" y="2" width="8" height="5" rx="1" />
        <rect x="2" y="17" width="7" height="5" rx="1" />
        <rect x="15" y="17" width="7" height="5" rx="1" />
        <path d="M12 7v5M5 17v-5h14v5" />
      </>
    ),
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6M21 21v-3a6 6 0 0 0-4-5" />
      </>
    ),
    tool: (
      <>
        <path d="m14 5 5 5M14 5l5-3 3 3-3 5M14 5 3 16l-1 6 6-1L19 10" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4" />
      </>
    ),
    arrow: (
      <>
        <path d="M4 12h16m-6-6 6 6-6 6" />
      </>
    ),
    clock: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M12 7v5l3 2" />
      </>
    ),
    plus: <path d="M12 5v14M5 12h14" />,
    search: (
      <>
        <circle cx="10" cy="10" r="6" />
        <path d="m15 15 6 6" />
      </>
    ),
    logout: (
      <>
        <path d="M9 3H4v18h5M10 12h12m-4-4 4 4-4 4" />
      </>
    ),
  };
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name] ?? paths.file}
    </svg>
  );
}
export function Brand() {
  return (
    <span className="brand">
      <span className="brand-mark">F</span>
      <span>
        FlowForge<span className="brand-dot">.</span>
      </span>
    </span>
  );
}
export function Status({ value }: { value: string }) {
  const colors: Record<string, string> = {
    RUNNING: 'blue',
    COMPLETED: 'green',
    RETURNED: 'orange',
    BLOCKED: 'red',
    REJECTED: 'red',
    WITHDRAWN: 'default',
    RESOLVED: 'orange',
    IN_PROGRESS: 'blue',
    CLOSED: 'green',
  };
  return (
    <Tag color={colors[value] ?? 'default'} className="status-tag">
      <span className="status-dot" />
      {statusLabels[value] ?? value}
    </Tag>
  );
}
export function TypeTag({ type }: { type: ApplicationType }) {
  return <span className={`type-tag type-${type.toLowerCase()}`}>{typeLabels[type]}</span>;
}
export function PageTitle({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <div className="eyebrow">{eyebrow}</div>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action}
    </div>
  );
}
export function formatDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
}
export const roleLabels = {
  admin: '企业管理员',
  manager: '部门负责人',
  approver: '审批专员',
  agent: '服务工程师',
  employee: '企业成员',
};
