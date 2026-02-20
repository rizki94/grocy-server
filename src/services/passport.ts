import passport from "passport";
import { Strategy as LocalStrategy } from "passport-local";
import bcrypt from "bcrypt";
import { eq, InferSelectModel } from "drizzle-orm";
import { db } from "@/db";
import { users } from "@/db/schemas";
import { rolePermissions } from "@/db/schemas/role-permission.schema";
import { permissions } from "@/db/schemas/permission.schema";
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

        if (!user) return done(new Error("User not found"), null);

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

        const allowedPermissions = rows
            .filter((row) => row.hasPermission)
            .map((row) => row.code);

        const userWithAccess = {
            ...user,
            permissions: allowedPermissions,
        };

        done(null, userWithAccess);
    } catch (err) {
        done(err, null);
    }
});

export const passportMiddleware = [passport.initialize(), passport.session()];
