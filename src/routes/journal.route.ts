import {
    createJournalController,
    getAllJournals,
    getJournalById,
    getPaginatedJournals,
    postJournal,
    updateJournalController,
} from "@/controllers/journal.controller";
import { Router } from "express";

const journalRoute = Router();

journalRoute.get("/", getAllJournals);
journalRoute.get("/paginated", getPaginatedJournals);
journalRoute.post("/", createJournalController);
journalRoute.put("/post/:id", postJournal);
journalRoute.get("/:id", getJournalById);
journalRoute.put("/:id", updateJournalController);

export default journalRoute;
