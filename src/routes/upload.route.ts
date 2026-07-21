import { Router, Request, Response } from "express";
import multer, { FileFilterCallback } from "multer";
import path from "path";
import fs from "fs";
import { db } from "@/db";
import { productImages } from "@/db/schemas";

const uploadRouter = Router();

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/"),
    filename: (_req, file, cb) => {
        const uniqueName = Date.now() + path.extname(file.originalname);
        cb(null, uniqueName);
    },
});

const fileFilter = (
    _req: Request,
    file: Express.Multer.File,
    cb: FileFilterCallback
) => {
    const allowedMimeTypes = [
        "image/",
        "video/",
        "audio/",
        "application/pdf",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/plain",
        "application/zip",
        "application/x-zip-compressed",
    ];
    const isAllowed = allowedMimeTypes.some(mime => file.mimetype.startsWith(mime));
    if (isAllowed) cb(null, true);
    else cb(new Error("File type not allowed!"));
};

const upload = multer({
    storage,
    fileFilter,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB for video/audio
});

uploadRouter.post(
    "/upload",
    upload.array("images", 10),
    async (req: Request, res: Response) => {
        const files = req.files as Express.Multer.File[];
        if (!files?.length)
            return res.status(400).json({ error: "No files uploaded" });

        const { productId } = req.query as { productId?: string };
        let result: any[] = [];

        if (productId) {
            // insert ke DB
            result = await Promise.all(
                files.map(async (f) => {
                    const [img] = await db
                        .insert(productImages)
                        .values({
                            productId,
                            url: `/uploads/${f.filename}`,
                            filename: f.filename,
                            mimetype: f.mimetype,
                            size: f.size,
                        })
                        .returning();
                    return img;
                })
            );
        } else {
            result = files.map((f) => ({
                filename: f.filename,
                url: `/uploads/${f.filename}`,
                mimetype: f.mimetype,
                size: f.size,
            }));
        }

        res.json(result);
    }
);

uploadRouter.delete("/:filename", async (req: Request, res: Response) => {
    const { filename } = req.params;

    try {
        const uploadsDir = path.join(process.cwd(), "uploads");
        const filePath = path.join(uploadsDir, filename);

        if (!filePath.startsWith(uploadsDir)) {
            return res.status(400).json({ error: "invalid filename" });
        }

        await fs.promises.unlink(filePath);

        return res.json({ message: "file deleted" });
    } catch (e) {
        return res.status(404).json({ error: "file not found" });
    }
});

export default uploadRouter;
