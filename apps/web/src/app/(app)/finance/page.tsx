import { redirect } from "next/navigation";
import { sousPagesAutorisees } from "../../../lib/navigation";
import { obtenirSession } from "../../../lib/session";

/** La rubrique ouvre sa première sous-page autorisée. */
export default async function PageFinance() {
  const { utilisateur } = await obtenirSession();
  const [premiere] = sousPagesAutorisees("finance", utilisateur.roles);
  redirect(premiere ? premiere.href : "/acces-refuse");
}
