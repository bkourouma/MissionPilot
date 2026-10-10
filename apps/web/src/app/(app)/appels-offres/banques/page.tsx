import { redirect } from "next/navigation";
import { RACINE_BANQUES } from "../../../../lib/banque-ao";

/** Entrée de la rubrique : la banque de CV. */
export default function PageBanques() {
  redirect(`${RACINE_BANQUES}/cv`);
}
