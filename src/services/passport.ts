import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { eq, InferSelectModel } from "drizzle-orm";
import { db } from "@/db";
import { users, branches, roles } from "@/db/schemas";
import { rolePermissions } from "@/db/schemas/role-permission.schema";
import { permissions } from "@/db/schemas/permission.schema";
import { ALL_PERMISSION_CODES } from "@/constants/permissions.constant";
passport.use(
    new LocalStrategy(async (username, password, done) => {
        try {
            const [user] = await db
                .select()
                .from(users)
                .where(eq(users.username, username))
                .limit(1);

            if (!user) return done(null, false, { message: "User not found" });

            const isMatch = await bcrypt.compare(password, user.password);
            if (!isMatch)
                return done(null, false, { message: "Wrong password" });

            return done(null, user);
        } catch (err) {
            return done(err);
        }
    })
);

passport.serializeUser((user: Express.User, done) => {
    done(null, user.id);
});

passport.deserializeUser(async (id: string, done) => {
    try {
        const [user] = await db
            .select()
            .from(users)
            .where(eq(users.id, id))
            .limit(1);

        if (!user) {
            // Stale session or user from another database: treat as unauthenticated
            return done(null, false);
        }

        let branch = null;
        if (user.branchId) {
            const [b] = await db
                .select()
                .from(branches)
                .where(eq(branches.id, user.branchId))
                .limit(1);
            branch = b || null;
        }

        let roleName = "user";
        let isSuperAdmin = false;
        if (user.roleId) {
            const [role] = await db
                .select()
                .from(roles)
                .where(eq(roles.id, user.roleId))
                .limit(1);
            if (role) {
                roleName = role.name;
                isSuperAdmin = role.name === "super_admin";
            }
        }

        let allowedPermissions: string[] = [];

        if (isSuperAdmin) {
            // Super Admin always receives all permissions
            const allPerms = await db
                .select({ code: permissions.code })
                .from(permissions);
            const dbCodes = allPerms.map((p) => p.code);
            allowedPermissions = Array.from(new Set([...dbCodes, ...ALL_PERMISSION_CODES]));
        } else {
            const rows = await db
                .select({
                    code: permissions.code,
                    description: permissions.description,
                    hasPermission: rolePermissions.hasPermission,
                })
                .from(rolePermissions)
                .innerJoin(
                    permissions,
                    eq(rolePermissions.permissionId, permissions.id)
                )
                .where(eq(rolePermissions.roleId, user.roleId));

            allowedPermissions = rows
                .filter((row) => row.hasPermission)
                .map((row) => row.code);
        }

        const userWithAccess = {
            ...user,
            role: roleName,
            isSuperAdmin,
            branch,
            isHq: branch?.isHq ?? false,
            permissions: allowedPermissions,
        };

        done(null, userWithAccess);
    } catch (err) {
        // Prevent session deserialization failure from crashing requests
        done(null, false);
    }
});

export const passportMiddleware = [passport.initialize(), passport.session()];
