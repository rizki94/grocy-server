import { Router } from "express";
import { isAuthenticated } from "@/middleware/auth";
import {
    getAllBranches,
    getBranchById,
    createBranch,
    updateBranch,
    deleteBranch,
} from "@/controllers/branch.controller";

const router = Router();

router.use(isAuthenticated);

router.get("/", getAllBranches);
router.get("/:id", getBranchById);
router.post("/", createBranch);
router.put("/:id", updateBranch);
router.delete("/:id", deleteBranch);

export { router as branchRoute };
