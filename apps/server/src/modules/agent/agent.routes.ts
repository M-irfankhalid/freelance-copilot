import { Router } from "express";

import { parseBody } from "../../lib/validate.js";
import { agentChatSchema, chatWithAgent } from "./agent.service.js";

export const agentRouter = Router();

agentRouter.post("/chat", async (req, res, next) => {
  try {
    const input = parseBody(agentChatSchema, req.body);
    res.json(await chatWithAgent(req.user!.id, input));
  } catch (error) {
    next(error);
  }
});
