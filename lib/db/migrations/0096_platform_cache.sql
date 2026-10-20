-- ip_geo (where a sign-in IP is) is a cache of public facts shared by the whole platform, not an org's data: the
-- platform fills it after a sign-in (lib/ip-geo.ts, withPlatform) and every org's sign-in log reads it.
DROP POLICY ip_geo_super ON ip_geo;
--> statement-breakpoint
CREATE POLICY ip_geo_read ON ip_geo FOR SELECT USING (app_is_platform() OR app_org() IS NOT NULL);
--> statement-breakpoint
CREATE POLICY ip_geo_write ON ip_geo FOR ALL USING (app_is_platform()) WITH CHECK (app_is_platform());
