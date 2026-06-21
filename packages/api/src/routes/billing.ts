import { Router, type Request, type Response } from "express";

// Ported verbatim from the reference's routes/billing.ts. Early-access build:
// every user is on the free plan with all features unlocked. No data layer —
// this is a static shape until Stripe is wired up.

export const billingRouter = Router();

// GET /api/billing/subscription
billingRouter.get("/subscription", async (_req: Request, res: Response) => {
  res.json({
    plan: "free",
    status: "active",
    early_access: true,
    features: { all: true },
  });
});
