-- そのゲームの募集で既定でメンションするロール。NULL ならメンションしない
ALTER TABLE games ADD COLUMN notify_role_id TEXT;
