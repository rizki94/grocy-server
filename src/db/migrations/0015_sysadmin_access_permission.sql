-- Add sysadmin permission group and sysadmin.access permission
INSERT INTO "permission_groups" ("id", "name")
VALUES ('00000000-0000-0000-0000-000000000099', 'System Administration')
ON CONFLICT ("name") DO NOTHING;

INSERT INTO "permissions" ("id", "code", "description", "group_id")
VALUES (
    '00000000-0000-0000-0000-000000000199',
    'sysadmin.access',
    'Access the System Administration area',
    (SELECT id FROM permission_groups WHERE name = 'System Administration')
)
ON CONFLICT ("code") DO NOTHING;
