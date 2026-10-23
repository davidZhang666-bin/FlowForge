-- Cross-tenant references must be impossible even when application validation fails.
ALTER TABLE departments ADD CONSTRAINT departments_tenant_fk FOREIGN KEY ("tenantId") REFERENCES tenants(id);
ALTER TABLE departments ADD CONSTRAINT departments_parent_fk FOREIGN KEY ("tenantId", "parentId") REFERENCES departments("tenantId", id);
ALTER TABLE memberships ADD CONSTRAINT memberships_tenant_fk FOREIGN KEY ("tenantId") REFERENCES tenants(id);
ALTER TABLE memberships ADD CONSTRAINT memberships_user_fk FOREIGN KEY ("userId") REFERENCES users(id);
ALTER TABLE memberships ADD CONSTRAINT memberships_department_fk FOREIGN KEY ("tenantId", "departmentId") REFERENCES departments("tenantId", id);
ALTER TABLE sessions ADD CONSTRAINT sessions_user_fk FOREIGN KEY ("userId") REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE flow_definitions ADD CONSTRAINT definitions_tenant_fk FOREIGN KEY ("tenantId") REFERENCES tenants(id);
ALTER TABLE flow_versions ADD CONSTRAINT versions_definition_fk FOREIGN KEY ("tenantId", "definitionId") REFERENCES flow_definitions("tenantId", id);
ALTER TABLE flow_versions ADD CONSTRAINT versions_publisher_fk FOREIGN KEY ("tenantId", "publishedBy") REFERENCES memberships("tenantId", "userId");
ALTER TABLE process_instances ADD CONSTRAINT instances_version_fk FOREIGN KEY ("tenantId", "versionId") REFERENCES flow_versions("tenantId", id);
ALTER TABLE process_instances ADD CONSTRAINT instances_applicant_fk FOREIGN KEY ("tenantId", "applicantId") REFERENCES memberships("tenantId", "userId");
ALTER TABLE process_instances ADD CONSTRAINT instances_department_fk FOREIGN KEY ("tenantId", "departmentId") REFERENCES departments("tenantId", id);
ALTER TABLE process_instances ADD CONSTRAINT instances_link_fk FOREIGN KEY ("tenantId", "linkedFrom") REFERENCES process_instances("tenantId", id);
ALTER TABLE task_index ADD CONSTRAINT tasks_instance_fk FOREIGN KEY ("tenantId", "instanceId") REFERENCES process_instances("tenantId", id);
ALTER TABLE task_index ADD CONSTRAINT tasks_assignee_fk FOREIGN KEY ("tenantId", "assigneeId") REFERENCES memberships("tenantId", "userId");
ALTER TABLE participants ADD CONSTRAINT participants_instance_fk FOREIGN KEY ("tenantId", "instanceId") REFERENCES process_instances("tenantId", id);
ALTER TABLE participants ADD CONSTRAINT participants_user_fk FOREIGN KEY ("tenantId", "userId") REFERENCES memberships("tenantId", "userId");
ALTER TABLE domain_events ADD CONSTRAINT events_instance_fk FOREIGN KEY ("tenantId", "instanceId") REFERENCES process_instances("tenantId", id);
ALTER TABLE outbox ADD CONSTRAINT outbox_event_fk FOREIGN KEY ("tenantId", "eventId") REFERENCES domain_events("tenantId", id);
ALTER TABLE notifications ADD CONSTRAINT notifications_event_fk FOREIGN KEY ("tenantId", "eventId") REFERENCES domain_events("tenantId", id);
ALTER TABLE notifications ADD CONSTRAINT notifications_user_fk FOREIGN KEY ("tenantId", "userId") REFERENCES memberships("tenantId", "userId");
ALTER TABLE audit_logs ADD CONSTRAINT audits_event_fk FOREIGN KEY ("tenantId", id) REFERENCES domain_events("tenantId", id);

DO $$
DECLARE relation_name text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY['departments','memberships','flow_definitions','flow_versions','process_instances','task_index','participants','domain_events','outbox','notifications','audit_logs','idempotency_records'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', relation_name);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid) WITH CHECK ("tenantId" = NULLIF(current_setting(''app.tenant_id'', true), '''')::uuid)', relation_name);
  END LOOP;
END $$;

CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION '% is append-only', TG_TABLE_NAME; END;
$$;
CREATE TRIGGER immutable_versions BEFORE UPDATE OR DELETE ON flow_versions FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_events BEFORE UPDATE OR DELETE ON domain_events FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
CREATE TRIGGER immutable_audits BEFORE UPDATE OR DELETE ON audit_logs FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();

ALTER TABLE memberships ADD CONSTRAINT valid_role CHECK (role IN ('admin','manager','approver','agent','employee'));
ALTER TABLE memberships ADD CONSTRAINT valid_scope CHECK (scope IN ('SELF','DEPARTMENT','DEPARTMENT_TREE','TENANT'));
ALTER TABLE process_instances ADD CONSTRAINT valid_revision CHECK (revision >= 0);
ALTER TABLE flow_versions ADD CONSTRAINT valid_version CHECK (number > 0);
