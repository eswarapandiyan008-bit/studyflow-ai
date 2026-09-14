import { Router, type IRouter } from "express";
import healthRouter from "./health";
import studyflowRouter from "./studyflow";

const router: IRouter = Router();

router.use(healthRouter);
router.use(studyflowRouter);

export default router;
