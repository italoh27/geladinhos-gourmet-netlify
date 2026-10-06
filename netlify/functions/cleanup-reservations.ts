import type { Config } from "@netlify/functions";
import { reconcileExpiredPayments } from "./_shared/payment";

export default async () => {
  await reconcileExpiredPayments();
};

export const config: Config = {
  schedule: "*/5 * * * *",
};

