import { redirect } from "next/navigation";
import { hrefSignaux } from "../../../../lib/due-diligence";

/** La rubrique s'ouvre sur la bibliothèque de signaux d'alerte. */
export default function PageParametresDd() {
  redirect(hrefSignaux);
}
