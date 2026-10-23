CREATE TABLE management_logs (
  id UUID PRIMARY KEY,
  "tenantId" UUID NOT NULL REFERENCES tenants(id),
  "actorId" UUID NOT NULL,
  action TEXT NOT NULL,
  "subjectId" UUID NOT NULL,
  payload JSONB NOT NULL,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT management_actor_fk FOREIGN KEY ("tenantId", "actorId") REFERENCES memberships("tenantId", "userId")
);
CREATE INDEX "management_logs_tenantId_occurredAt_idx" ON management_logs("tenantId", "occurredAt");
ALTER TABLE management_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE management_logs FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON management_logs USING ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
CREATE TRIGGER immutable_management BEFORE UPDATE OR DELETE ON management_logs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
