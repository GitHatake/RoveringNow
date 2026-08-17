CREATE TABLE "audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" uuid,
	"ip_address" "inet",
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "blocks_blocker_id_blocked_id_pk" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "ck_blocks_not_self" CHECK ("blocks"."blocker_id" <> "blocks"."blocked_id")
);
--> statement-breakpoint
CREATE TABLE "comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"post_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'published' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_comments_status" CHECK ("comments"."status" in ('published', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "connections" (
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"established_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	CONSTRAINT "connections_user_a_id_user_b_id_pk" PRIMARY KEY("user_a_id","user_b_id"),
	CONSTRAINT "ck_connections_status" CHECK ("connections"."status" in ('active', 'released')),
	CONSTRAINT "ck_connections_order" CHECK ("connections"."user_a_id" < "connections"."user_b_id")
);
--> statement-breakpoint
CREATE TABLE "group_broadcast_exclusions" (
	"ancestor_group_id" uuid NOT NULL,
	"excluded_group_id" uuid NOT NULL,
	"excluded_by_user_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_broadcast_exclusions_ancestor_group_id_excluded_group_id_pk" PRIMARY KEY("ancestor_group_id","excluded_group_id"),
	CONSTRAINT "ck_gbe_not_self" CHECK ("group_broadcast_exclusions"."ancestor_group_id" <> "group_broadcast_exclusions"."excluded_group_id")
);
--> statement-breakpoint
CREATE TABLE "group_certification_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_gcr_status" CHECK ("group_certification_requests"."status" in ('pending', 'approved', 'rejected'))
);
--> statement-breakpoint
CREATE TABLE "group_mutes" (
	"user_id" uuid NOT NULL,
	"group_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "group_mutes_user_id_group_id_pk" PRIMARY KEY("user_id","group_id")
);
--> statement-breakpoint
CREATE TABLE "group_parent_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"child_group_id" uuid NOT NULL,
	"parent_group_id" uuid NOT NULL,
	"requested_by_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"decided_by_user_id" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_gpr_status" CHECK ("group_parent_requests"."status" in ('pending', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "ck_gpr_not_self" CHECK ("group_parent_requests"."child_group_id" <> "group_parent_requests"."parent_group_id")
);
--> statement-breakpoint
CREATE TABLE "groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"name_normalized" text NOT NULL,
	"kind" text NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"parent_group_id" uuid,
	"join_policy" text NOT NULL,
	"is_certified" boolean DEFAULT false NOT NULL,
	"description" text,
	"expires_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"join_qr_token" text NOT NULL,
	"archived_at" timestamp with time zone,
	"dormant_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "groups_join_qr_token_unique" UNIQUE("join_qr_token"),
	CONSTRAINT "ck_groups_kind" CHECK ("groups"."kind" in ('official', 'project', 'event', 'other')),
	CONSTRAINT "ck_groups_join_policy" CHECK ("groups"."join_policy" in ('invite', 'request', 'open')),
	CONSTRAINT "ck_groups_status" CHECK ("groups"."status" in ('active', 'archived', 'dormant')),
	CONSTRAINT "ck_groups_not_self_parent" CHECK ("groups"."parent_group_id" is distinct from "groups"."id")
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"status" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"invited_by_user_id" uuid,
	"joined_at" timestamp with time zone,
	"left_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_memberships_status" CHECK ("memberships"."status" in ('invited', 'requested', 'active', 'rejected', 'left')),
	CONSTRAINT "ck_memberships_role" CHECK ("memberships"."role" in ('admin', 'member'))
);
--> statement-breakpoint
CREATE TABLE "notification_settings" (
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	CONSTRAINT "notification_settings_user_id_channel_pk" PRIMARY KEY("user_id","channel"),
	CONSTRAINT "ck_ns_channel" CHECK ("notification_settings"."channel" in ('N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8')),
	CONSTRAINT "ck_ns_n8_always_on" CHECK ("notification_settings"."channel" <> 'N8' or "notification_settings"."enabled" = true)
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"body" text NOT NULL,
	"link" text NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_notifications_channel" CHECK ("notifications"."channel" in ('N1', 'N2', 'N3', 'N4', 'N5', 'N6', 'N7', 'N8'))
);
--> statement-breakpoint
CREATE TABLE "post_audiences" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"source_group_id" uuid NOT NULL,
	"post_created_at" timestamp with time zone NOT NULL,
	CONSTRAINT "post_audiences_post_id_user_id_pk" PRIMARY KEY("post_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "posts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"scope" text NOT NULL,
	"event_at" timestamp with time zone,
	"status" text DEFAULT 'published' NOT NULL,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_posts_scope" CHECK ("posts"."scope" in ('self', 'descendants')),
	CONSTRAINT "ck_posts_status" CHECK ("posts"."status" in ('published', 'deleted'))
);
--> statement-breakpoint
CREATE TABLE "profile_cards" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"avatar_path" text,
	"bio" text,
	"external_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"shows_affiliation" boolean DEFAULT true NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"qr_token" text NOT NULL,
	"qr_token_rotated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "profile_cards_qr_token_unique" UNIQUE("qr_token")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"failure_count" integer DEFAULT 0 NOT NULL,
	"last_failure_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "reactions" (
	"post_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reactions_post_id_user_id_kind_pk" PRIMARY KEY("post_id","user_id","kind"),
	CONSTRAINT "ck_reactions_kind" CHECK ("reactions"."kind" in ('ack', 'joining'))
);
--> statement-breakpoint
CREATE TABLE "reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"handled_by_user_id" uuid,
	"handled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ck_reports_target_type" CHECK ("reports"."target_type" in ('post', 'comment', 'card', 'stamp', 'group')),
	CONSTRAINT "ck_reports_status" CHECK ("reports"."status" in ('pending', 'in_progress', 'resolved', 'dismissed'))
);
--> statement-breakpoint
CREATE TABLE "stamp_grants" (
	"stamp_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"method" text NOT NULL,
	"granted_by_user_id" uuid,
	"status" text DEFAULT 'valid' NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	CONSTRAINT "stamp_grants_stamp_id_user_id_pk" PRIMARY KEY("stamp_id","user_id"),
	CONSTRAINT "ck_stamp_grants_method" CHECK ("stamp_grants"."method" in ('venue_qr', 'roll_call', 'manual')),
	CONSTRAINT "ck_stamp_grants_status" CHECK ("stamp_grants"."status" in ('valid', 'revoked'))
);
--> statement-breakpoint
CREATE TABLE "stamps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"group_id" uuid NOT NULL,
	"name" text NOT NULL,
	"activity_date" date NOT NULL,
	"design" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"acquisition_method" text NOT NULL,
	"qr_token" text,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stamps_qr_token_unique" UNIQUE("qr_token"),
	CONSTRAINT "ck_stamps_method" CHECK ("stamps"."acquisition_method" in ('venue_qr', 'roll_call')),
	CONSTRAINT "ck_stamps_valid_period" CHECK ("stamps"."valid_from" < "stamps"."valid_until"),
	CONSTRAINT "ck_stamps_qr_token_presence" CHECK (("stamps"."acquisition_method" = 'venue_qr') = ("stamps"."qr_token" is not null))
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"auth_user_id" uuid,
	"display_name" text,
	"email" text,
	"status" text DEFAULT 'active' NOT NULL,
	"withdrawn_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_auth_user_id_unique" UNIQUE("auth_user_id"),
	CONSTRAINT "ck_users_status" CHECK ("users"."status" in ('active', 'suspended', 'withdrawn')),
	CONSTRAINT "ck_users_withdrawn_is_anonymized" CHECK ("users"."status" <> 'withdrawn' or ("users"."display_name" is null and "users"."email" is null and "users"."auth_user_id" is null))
);
--> statement-breakpoint
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "blocks" ADD CONSTRAINT "blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "comments" ADD CONSTRAINT "comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "connections" ADD CONSTRAINT "connections_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_broadcast_exclusions" ADD CONSTRAINT "group_broadcast_exclusions_ancestor_group_id_groups_id_fk" FOREIGN KEY ("ancestor_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_broadcast_exclusions" ADD CONSTRAINT "group_broadcast_exclusions_excluded_group_id_groups_id_fk" FOREIGN KEY ("excluded_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_broadcast_exclusions" ADD CONSTRAINT "group_broadcast_exclusions_excluded_by_user_id_users_id_fk" FOREIGN KEY ("excluded_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_certification_requests" ADD CONSTRAINT "group_certification_requests_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_certification_requests" ADD CONSTRAINT "group_certification_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_certification_requests" ADD CONSTRAINT "group_certification_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_mutes" ADD CONSTRAINT "group_mutes_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_parent_requests" ADD CONSTRAINT "group_parent_requests_child_group_id_groups_id_fk" FOREIGN KEY ("child_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_parent_requests" ADD CONSTRAINT "group_parent_requests_parent_group_id_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_parent_requests" ADD CONSTRAINT "group_parent_requests_requested_by_user_id_users_id_fk" FOREIGN KEY ("requested_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "group_parent_requests" ADD CONSTRAINT "group_parent_requests_decided_by_user_id_users_id_fk" FOREIGN KEY ("decided_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_parent_group_id_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_invited_by_user_id_users_id_fk" FOREIGN KEY ("invited_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_settings" ADD CONSTRAINT "notification_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_audiences" ADD CONSTRAINT "post_audiences_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_audiences" ADD CONSTRAINT "post_audiences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "post_audiences" ADD CONSTRAINT "post_audiences_source_group_id_groups_id_fk" FOREIGN KEY ("source_group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "posts" ADD CONSTRAINT "posts_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "profile_cards" ADD CONSTRAINT "profile_cards_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_post_id_posts_id_fk" FOREIGN KEY ("post_id") REFERENCES "public"."posts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reactions" ADD CONSTRAINT "reactions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_user_id_users_id_fk" FOREIGN KEY ("handled_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_grants" ADD CONSTRAINT "stamp_grants_stamp_id_stamps_id_fk" FOREIGN KEY ("stamp_id") REFERENCES "public"."stamps"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_grants" ADD CONSTRAINT "stamp_grants_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamp_grants" ADD CONSTRAINT "stamp_grants_granted_by_user_id_users_id_fk" FOREIGN KEY ("granted_by_user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stamps" ADD CONSTRAINT "stamps_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_logs_user" ON "audit_logs" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_audit_logs_target" ON "audit_logs" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_blocks_blocked" ON "blocks" USING btree ("blocked_id");--> statement-breakpoint
CREATE INDEX "idx_comments_post" ON "comments" USING btree ("post_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_connections_b" ON "connections" USING btree ("user_b_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gcr_pending_group" ON "group_certification_requests" USING btree ("group_id") WHERE "group_certification_requests"."status" = 'pending';--> statement-breakpoint
CREATE UNIQUE INDEX "uq_gpr_pending_child" ON "group_parent_requests" USING btree ("child_group_id") WHERE "group_parent_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "idx_gpr_parent" ON "group_parent_requests" USING btree ("parent_group_id");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_groups_name_normalized" ON "groups" USING btree ("name_normalized");--> statement-breakpoint
CREATE INDEX "idx_groups_parent" ON "groups" USING btree ("parent_group_id");--> statement-breakpoint
CREATE INDEX "idx_groups_status" ON "groups" USING btree ("status");--> statement-breakpoint
CREATE UNIQUE INDEX "uq_memberships_group_user" ON "memberships" USING btree ("group_id","user_id");--> statement-breakpoint
CREATE INDEX "idx_memberships_admin" ON "memberships" USING btree ("group_id") WHERE "memberships"."role" = 'admin' and "memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_memberships_user_active" ON "memberships" USING btree ("user_id") WHERE "memberships"."status" = 'active';--> statement-breakpoint
CREATE INDEX "idx_notifications_user" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_post_audiences_timeline" ON "post_audiences" USING btree ("user_id","post_created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "idx_posts_group" ON "posts" USING btree ("group_id","created_at");--> statement-breakpoint
CREATE INDEX "idx_push_subscriptions_user" ON "push_subscriptions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_reports_status" ON "reports" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "idx_reports_target" ON "reports" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "idx_stamp_grants_user" ON "stamp_grants" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "idx_stamps_group" ON "stamps" USING btree ("group_id");