import "express";

declare global {
    namespace Express {
        interface User {
            id: string;
            username: string;
            displayName?: string | null;
            avatar?: string | null;
            roleId: string;
            isActive: boolean;
            permissions?: string[];
        }
    }
}
