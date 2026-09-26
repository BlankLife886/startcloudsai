-- +goose Up
ALTER TABLE plan_versions ADD COLUMN actor_id uuid REFERENCES admin_accounts(id) ON DELETE SET NULL,
 ADD COLUMN actor_name text, ADD COLUMN action text NOT NULL DEFAULT 'legacy';
CREATE INDEX ix_orders_plan_revision ON orders(plan_id,plan_revision_snapshot);
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION version_billing_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'updated_at'-'revision')=(to_jsonb(OLD)-'updated_at'-'revision') THEN RETURN NEW; END IF;
  NEW.revision=OLD.revision+1;
 END IF;
 INSERT INTO plan_versions(plan_id,revision,snapshot,actor_id,actor_name,action)
 VALUES(NEW.id,NEW.revision,to_jsonb(NEW),NULLIF(current_setting('app.plan_actor_id',true),'')::uuid,
 NULLIF(current_setting('app.plan_actor_name',true),''),CASE WHEN TG_OP='INSERT' THEN 'create' ELSE 'update' END);
 RETURN NEW;
END $$;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION version_billing_plan() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-'updated_at'-'revision')=(to_jsonb(OLD)-'updated_at'-'revision') THEN RETURN NEW; END IF;
  NEW.revision=OLD.revision+1;
 END IF;
 INSERT INTO plan_versions(plan_id,revision,snapshot) VALUES(NEW.id,NEW.revision,to_jsonb(NEW)) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
-- +goose StatementEnd
DROP INDEX ix_orders_plan_revision;
ALTER TABLE plan_versions DROP COLUMN actor_id,DROP COLUMN actor_name,DROP COLUMN action;
