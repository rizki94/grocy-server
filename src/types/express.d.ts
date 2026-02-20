import "express";

declare global {
    namespace Express {
        interface User {
            id: string;
            username: string;
            roleId: string;
            isActive: boolean;
        }
    }
}
