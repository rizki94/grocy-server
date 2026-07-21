import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { sessionMiddleware } from "./session";
import passport from "passport";

let io: SocketIOServer | null = null;

// Map of userId -> Set of socketIds
const userSockets = new Map<string, Set<string>>();

export function initSocketServer(server: HTTPServer) {
    io = new SocketIOServer(server, {
        cors: {
            origin: true, // Allow client origin
            credentials: true,
        },
    });

    // Share session middleware
    io.use((socket, next) => {
        const req = socket.request as any;
        sessionMiddleware(req, {} as any, next as any);
    });

    // Share passport middleware
    io.use((socket, next) => {
        const req = socket.request as any;
        passport.initialize()(req, {} as any, () => {
            passport.session()(req, {} as any, () => {
                if (req.user) {
                    next();
                } else {
                    next(new Error("Unauthorized"));
                }
            });
        });
    });

    io.on("connection", (socket: Socket) => {
        const req = socket.request as any;
        const userId = req.user.id;

        if (!userSockets.has(userId)) {
            userSockets.set(userId, new Set());
        }
        userSockets.get(userId)!.add(socket.id);

        // Join personal room for push notifications
        socket.join(`user:${userId}`);
        
        console.log(`🔌 Socket connected: user ${userId} (${socket.id})`);

        // Handle joining conversations
        socket.on("join:conversation", (conversationId: string) => {
            socket.join(`conversation:${conversationId}`);
            console.log(`👤 User ${userId} joined room conversation:${conversationId}`);
        });

        socket.on("leave:conversation", (conversationId: string) => {
            socket.leave(`conversation:${conversationId}`);
            console.log(`👤 User ${userId} left room conversation:${conversationId}`);
        });

        socket.on("disconnect", () => {
            const sockets = userSockets.get(userId);
            if (sockets) {
                sockets.delete(socket.id);
                if (sockets.size === 0) {
                    userSockets.delete(userId);
                }
            }
            console.log(`🔌 Socket disconnected: user ${userId} (${socket.id})`);
        });
    });

    return io;
}

export function getSocketIO() {
    return io;
}

// Push to specific users
export function sendRealtimeNotification(userId: string, notification: any) {
    if (io) {
        io.to(`user:${userId}`).emit("notification:new", notification);
    }
}

// Broadcast message to a conversation room
export function sendRealtimeMessage(conversationId: string, message: any) {
    if (io) {
        io.to(`conversation:${conversationId}`).emit("message:new", message);
    }
}

// Update conversation for participants (e.g. read status or new conversation created)
export function updateRealtimeConversation(userIds: string[], event: string, data: any) {
    if (io) {
        userIds.forEach(userId => {
            io!.to(`user:${userId}`).emit(event, data);
        });
    }
}
