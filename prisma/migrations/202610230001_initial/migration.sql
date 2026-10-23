-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "tokenHash" TEXT NOT NULL,
    "csrfHash" TEXT NOT NULL,
    "userId" UUID NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateTable
CREATE TABLE "login_attempts" (
    "key" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "windowStart" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "login_attempts_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "departments" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "parentId" UUID,

    CONSTRAINT "departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "memberships" (
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "role" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'SELF',
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "memberships_pkey" PRIMARY KEY ("tenantId","userId")
);

-- CreateTable
CREATE TABLE "flow_definitions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "draft" JSONB NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "latestVersion" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "flow_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "flow_versions" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "graph" JSONB NOT NULL,
    "publishedBy" UUID NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "flow_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "process_instances" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "applicantId" UUID NOT NULL,
    "departmentId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "linkedFrom" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "process_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "task_index" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "nodeId" TEXT NOT NULL,
    "round" INTEGER NOT NULL,
    "kind" TEXT NOT NULL,
    "assigneeId" UUID,
    "status" TEXT NOT NULL,
    "dueAt" TIMESTAMP(3) NOT NULL,
    "escalated" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "task_index_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "participants" (
    "tenantId" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "participants_pkey" PRIMARY KEY ("tenantId","instanceId","userId")
);

-- CreateTable
CREATE TABLE "domain_events" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" UUID NOT NULL,
    "nodeId" TEXT,
    "round" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domain_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox" (
    "eventId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "lastError" TEXT,

    CONSTRAINT "outbox_pkey" PRIMARY KEY ("eventId")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "eventId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "instanceId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "tenantId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "response" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("tenantId","actorId","key")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE INDEX "sessions_userId_idx" ON "sessions"("userId");

-- CreateIndex
CREATE INDEX "sessions_expiresAt_idx" ON "sessions"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_id_key" ON "departments"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "departments_tenantId_name_key" ON "departments"("tenantId", "name");

-- CreateIndex
CREATE INDEX "memberships_tenantId_departmentId_idx" ON "memberships"("tenantId", "departmentId");

-- CreateIndex
CREATE UNIQUE INDEX "flow_definitions_tenantId_id_key" ON "flow_definitions"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "flow_definitions_tenantId_type_key" ON "flow_definitions"("tenantId", "type");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_tenantId_id_key" ON "flow_versions"("tenantId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "flow_versions_tenantId_definitionId_number_key" ON "flow_versions"("tenantId", "definitionId", "number");

-- CreateIndex
CREATE INDEX "process_instances_tenantId_status_updatedAt_idx" ON "process_instances"("tenantId", "status", "updatedAt");

-- CreateIndex
CREATE INDEX "process_instances_tenantId_applicantId_idx" ON "process_instances"("tenantId", "applicantId");

-- CreateIndex
CREATE UNIQUE INDEX "process_instances_tenantId_id_key" ON "process_instances"("tenantId", "id");

-- CreateIndex
CREATE INDEX "task_index_tenantId_assigneeId_status_idx" ON "task_index"("tenantId", "assigneeId", "status");

-- CreateIndex
CREATE INDEX "task_index_tenantId_instanceId_idx" ON "task_index"("tenantId", "instanceId");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_tenantId_instanceId_sequence_key" ON "domain_events"("tenantId", "instanceId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "domain_events_tenantId_id_key" ON "domain_events"("tenantId", "id");

-- CreateIndex
CREATE INDEX "outbox_tenantId_processedAt_availableAt_idx" ON "outbox"("tenantId", "processedAt", "availableAt");

-- CreateIndex
CREATE INDEX "notifications_tenantId_userId_createdAt_idx" ON "notifications"("tenantId", "userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_tenantId_eventId_userId_key" ON "notifications"("tenantId", "eventId", "userId");

-- CreateIndex
CREATE INDEX "audit_logs_tenantId_instanceId_occurredAt_idx" ON "audit_logs"("tenantId", "instanceId", "occurredAt");
