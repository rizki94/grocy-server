import multer from "multer";

const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, "uploads/"),
    filename: (_req, file, cb) => {
        const unique = `${Date.now()}-${file.originalname.replace(
            /\s+/g,
            "-"
        )}`;
        cb(null, unique);
    },
});

export const upload = multer({
    storage,
    limits: { fileSize: 5 * 1024 * 1024 },
});

export type UploadedFile = Express.Multer.File;

export function getFileUrl(filename: string) {
    return `/uploads/${filename}`;
}
