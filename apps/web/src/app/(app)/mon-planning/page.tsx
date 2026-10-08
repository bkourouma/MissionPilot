import { redirect } from "next/navigation";
import { lireSemaine } from "../../../lib/semaine";

/** Ancien chemin des notifications (« /mon-planning ») : renvoie vers « Mon planning ». */
export default async function RedirectionMonPlanning({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const semaine = lireSemaine((await searchParams).semaine);
  redirect(semaine ? `/planning?semaine=${semaine}` : "/planning");
}
