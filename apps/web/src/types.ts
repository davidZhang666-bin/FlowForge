import type { Actor, DataScope, FlowGraph, Member, Role } from '../../../packages/contracts/src/index.js';
import type { ProcessState } from '../../../packages/core/src/index.js';
export interface Tenant { id: string; name: string; role: Role; scope: DataScope; departmentId: string }
export interface Session { user: { id: string; name: string; email: string }; tenants: Tenant[] }
export interface Version { id: string; number: number; graph: FlowGraph; publishedAt: string }
export interface Workflow { id: string; name: string; type: import('../../../packages/contracts/src/index.js').ApplicationType; revision: number; latestVersion: number; draft: FlowGraph; versions: Version[] }
export interface Instance { id: string; title: string; type: import('../../../packages/contracts/src/index.js').ApplicationType; status: string; revision: number; state: ProcessState; createdAt: string; updatedAt: string; versionId: string; versionNumber: number; applicantId: string; departmentId: string; linkedFrom: string | null }
export interface EventRecord { id: string; type: string; actorId: string; nodeId: string | null; round: number; sequence: number; payload: Record<string, unknown>; occurredAt: string }
export interface InstanceDetail extends Instance { version: Version; events: EventRecord[]; members: Member[] }
export interface Directory { departments: { id: string; name: string; parentId: string | null }[]; members: Member[]; memberships: { userId: string; role: Role; scope: DataScope; departmentId: string; active: boolean }[] }
export interface AppContext { session: Session; tenant: Tenant; actor: Actor; setTenant: (id: string) => void; logout: () => Promise<void> }
