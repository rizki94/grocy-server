import { Server as SocketIOServer, Socket } from "socket.io";
import { Server as HTTPServer } from "http";
import { sessionMiddleware } from "./session";
import passport from "passport";
import jwt from "jsonwebtoken";

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

    // Share passport middleware & token auth
    io.use((socket, next) => {
        const req = socket.request as any;
        passport.initialize()(req, {} as any, () => {
            passport.session()(req, {} as any, () => {
                if (req.user) {
                    return next();
                }

                // Check socket handshake auth / headers / query / req.headers for JWT token (mobile)
                const authHeader =
                    socket.handshake.headers?.authorization ||
                    req.headers?.authorization;

                const token =
                    socket.handshake.auth?.token ||
                    (authHeader && authHeader.startsWith("Bearer ")
                        ? authHeader.split(" ")[1]
                        : null) ||
                    (socket.handshake.query?.token as string);

                if (token) {
                    try {
                        const decoded = jwt.verify(
                            token,
                            process.env.JWT_SECRET || "secret"
                        ) as any;
                        req.user = decoded;
                        console.log(`🔑 Socket authenticated via JWT: user ${decoded.id}`);
                        return next();
                    } catch (err: any) {
                        console.error(`🔒 Socket JWT verify error: ${err.message}`);
                        return next(new Error(`Unauthorized: ${err.message}`));
                    }
                }

                console.error("🔒 Socket auth failed: No session and no JWT token provided");
                next(new Error("Unauthorized: No token provided"));
            });
        });
    });

    io.on("connection", (socket: Socket) => {
        const req = socket.request as any;
        const userId = String(req.user.id || req.user._id || req.user);

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
export function sendRealtimeNotification(userId: string | number, notification: any) {
    if (io) {
        const room = `user:${String(userId)}`;
        console.log(`📡 Emitting notification:new to room ${room}:`, notification.title);
        io.to(room).emit("notification:new", notification);
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
