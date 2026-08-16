import type { Config } from "@netlify/functions";
import { releaseExpiredReservations } from "./_shared/orders";

export default async () => {
  await releaseExpiredReservations();
};

export const config: Config = {
  schedule: "*/5 * * * *",
};

